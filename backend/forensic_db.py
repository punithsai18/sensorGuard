import sqlite3
import json
from pathlib import Path
from datetime import datetime, timedelta

DB_PATH = Path.home() / "AppData" / "Roaming" / "SensorGuard" / "forensic.db"

def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Table 1: permission_events
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS permission_events (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       TEXT NOT NULL,
            browser         TEXT NOT NULL,
            domain_hash     TEXT NOT NULL,
            permission_type TEXT NOT NULL,
            old_status      TEXT,
            new_status      TEXT NOT NULL,
            event_type      TEXT NOT NULL,
            scan_id         TEXT NOT NULL,
            expires_at      TEXT NOT NULL
        )
    """)

    # Table 2: history_snapshots
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history_snapshots (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp             TEXT NOT NULL,
            browser               TEXT NOT NULL,
            entry_count           INTEGER NOT NULL,
            history_fingerprint   TEXT NOT NULL,
            permission_fingerprint TEXT NOT NULL,
            previous_snapshot_id  INTEGER,
            change_type           TEXT NOT NULL,
            count_delta           INTEGER,
            expires_at            TEXT NOT NULL
        )
    """)

    # Table 3: tamper_alerts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tamper_alerts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp       TEXT NOT NULL,
            browser         TEXT NOT NULL,
            alert_type      TEXT NOT NULL,
            severity        TEXT NOT NULL,
            entries_before  INTEGER,
            entries_after   INTEGER,
            entries_removed INTEGER,
            snapshot_id     INTEGER,
            dismissed       INTEGER DEFAULT 0,
            dismissed_at    TEXT,
            dismissed_by    TEXT DEFAULT 'user',
            expires_at      TEXT NOT NULL
        )
    """)

    # Table 4: history_diffs
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS history_diffs (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp             TEXT NOT NULL,
            browser               TEXT NOT NULL,
            snapshot_id           INTEGER NOT NULL,
            added_domain_hashes   TEXT NOT NULL,
            removed_domain_hashes TEXT NOT NULL,
            added_count           INTEGER NOT NULL,
            removed_count         INTEGER NOT NULL,
            expires_at            TEXT NOT NULL
        )
    """)

    # Table 5: forensic_meta
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS forensic_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    
    # Initialize forensic_meta
    cursor.execute("INSERT OR IGNORE INTO forensic_meta (key, value) VALUES ('schema_version', '1')")
    cursor.execute("INSERT OR IGNORE INTO forensic_meta (key, value) VALUES ('created_at', ?)", (datetime.utcnow().isoformat(),))
    cursor.execute("INSERT OR IGNORE INTO forensic_meta (key, value) VALUES ('last_maintenance', '')")
    cursor.execute("INSERT OR IGNORE INTO forensic_meta (key, value) VALUES ('total_events_written', '0')")
    cursor.execute("INSERT OR IGNORE INTO forensic_meta (key, value) VALUES ('last_bulk_wipe_detected', '')")

    conn.commit()
    conn.close()


def _increment_total_events():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("UPDATE forensic_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'total_events_written'")
    conn.commit()
    conn.close()


def write_permission_event(
    browser: str,
    domain_hash: str,
    permission_type: str,
    old_status: str | None,
    new_status: str,
    event_type: str,
    scan_id: str
) -> int:
    now = datetime.utcnow()
    expires_at = (now + timedelta(days=90)).isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO permission_events (timestamp, browser, domain_hash, permission_type, old_status, new_status, event_type, scan_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (now.isoformat(), browser, domain_hash, permission_type, old_status, new_status, event_type, scan_id, expires_at))
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    _increment_total_events()
    return row_id


def write_history_snapshot(
    browser: str,
    entry_count: int,
    history_fingerprint: str,
    permission_fingerprint: str,
    previous_snapshot_id: int | None,
    change_type: str,
    count_delta: int
) -> int:
    now = datetime.utcnow()
    expires_at = (now + timedelta(days=30)).isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO history_snapshots (timestamp, browser, entry_count, history_fingerprint, permission_fingerprint, previous_snapshot_id, change_type, count_delta, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (now.isoformat(), browser, entry_count, history_fingerprint, permission_fingerprint, previous_snapshot_id, change_type, count_delta, expires_at))
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    _increment_total_events()
    return row_id


def write_tamper_alert(
    browser: str,
    alert_type: str,
    severity: str,
    entries_before: int,
    entries_after: int,
    entries_removed: int,
    snapshot_id: int
) -> int:
    now = datetime.utcnow()
    expires_at = (now + timedelta(days=90)).isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO tamper_alerts (timestamp, browser, alert_type, severity, entries_before, entries_after, entries_removed, snapshot_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (now.isoformat(), browser, alert_type, severity, entries_before, entries_after, entries_removed, snapshot_id, expires_at))
    row_id = cursor.lastrowid
    
    if alert_type == "BULK_WIPE":
        cursor.execute("UPDATE forensic_meta SET value = ? WHERE key = 'last_bulk_wipe_detected'", (now.isoformat(),))
    
    conn.commit()
    conn.close()
    
    _increment_total_events()
    return row_id


def write_history_diff(
    browser: str,
    snapshot_id: int,
    added_hashes: list[str],
    removed_hashes: list[str]
) -> int:
    now = datetime.utcnow()
    expires_at = (now + timedelta(days=7)).isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO history_diffs (timestamp, browser, snapshot_id, added_domain_hashes, removed_domain_hashes, added_count, removed_count, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (now.isoformat(), browser, snapshot_id, json.dumps(added_hashes), json.dumps(removed_hashes), len(added_hashes), len(removed_hashes), expires_at))
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    _increment_total_events()
    return row_id


def get_latest_snapshot(browser: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM history_snapshots 
        WHERE browser = ? 
        ORDER BY id DESC LIMIT 1
    """, (browser,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_undismissed_alerts() -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM tamper_alerts 
        WHERE dismissed = 0 
        ORDER BY timestamp DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_permission_events(browser: str | None = None, limit: int = 100) -> list[dict]:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    if browser:
        cursor.execute("""
            SELECT * FROM permission_events 
            WHERE browser = ? 
            ORDER BY timestamp DESC LIMIT ?
        """, (browser, limit))
    else:
        cursor.execute("""
            SELECT * FROM permission_events 
            ORDER BY timestamp DESC LIMIT ?
        """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def dismiss_alert(alert_id: int) -> None:
    now = datetime.utcnow().isoformat()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE tamper_alerts 
        SET dismissed = 1, dismissed_at = ? 
        WHERE id = ?
    """, (now, alert_id))
    conn.commit()
    conn.close()


def get_forensic_summary() -> dict:
    from backend.forensic_config import is_layer1_enabled, is_layer2_enabled, is_layer3_enabled
    
    summary = {
        "permission_events_total": 0,
        "snapshots_total": 0,
        "undismissed_alerts": 0,
        "last_snapshot_time": None,
        "last_alert_time": None,
        "layer1_active": is_layer1_enabled(),
        "layer2_active": is_layer2_enabled(),
        "layer3_active": is_layer3_enabled()
    }
    
    if not DB_PATH.exists():
        return summary
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM permission_events")
    summary["permission_events_total"] = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM history_snapshots")
    summary["snapshots_total"] = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM tamper_alerts WHERE dismissed = 0")
    summary["undismissed_alerts"] = cursor.fetchone()[0]
    
    cursor.execute("SELECT timestamp FROM history_snapshots ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    if row:
        summary["last_snapshot_time"] = row[0]
        
    cursor.execute("SELECT timestamp FROM tamper_alerts ORDER BY id DESC LIMIT 1")
    row = cursor.fetchone()
    if row:
        summary["last_alert_time"] = row[0]
        
    conn.close()
    return summary
