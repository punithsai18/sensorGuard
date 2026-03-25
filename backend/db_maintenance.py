import sqlite3
import os
from datetime import datetime
from backend.forensic_db import DB_PATH

def run_maintenance() -> dict:
    if not DB_PATH.exists():
        return {
            "permission_events_deleted": 0,
            "snapshots_deleted": 0,
            "alerts_deleted": 0,
            "diffs_deleted": 0,
            "ran_at": datetime.utcnow().isoformat()
        }
        
    now = datetime.utcnow().isoformat()
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Delete expired permission events
    cursor.execute("DELETE FROM permission_events WHERE expires_at < ?", (now,))
    events_deleted = cursor.rowcount
    
    # Delete expired snapshots
    cursor.execute("DELETE FROM history_snapshots WHERE expires_at < ?", (now,))
    snapshots_deleted = cursor.rowcount
    
    # Delete expired alerts
    cursor.execute("DELETE FROM tamper_alerts WHERE expires_at < ?", (now,))
    alerts_deleted = cursor.rowcount
    
    # Delete expired diffs
    cursor.execute("DELETE FROM history_diffs WHERE expires_at < ?", (now,))
    diffs_deleted = cursor.rowcount
    
    # Update last maintenance
    cursor.execute("UPDATE forensic_meta SET value = ? WHERE key = 'last_maintenance'", (now,))
    
    conn.commit()
    conn.close()
    
    return {
        "permission_events_deleted": events_deleted,
        "snapshots_deleted": snapshots_deleted,
        "alerts_deleted": alerts_deleted,
        "diffs_deleted": diffs_deleted,
        "ran_at": now
    }


def get_db_stats() -> dict:
    stats = {
        "permission_events_count": 0,
        "history_snapshots_count": 0,
        "tamper_alerts_count": 0,
        "history_diffs_count": 0,
        "db_size_kb": 0
    }
    
    if DB_PATH.exists():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute("SELECT COUNT(*) FROM permission_events")
        stats["permission_events_count"] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM history_snapshots")
        stats["history_snapshots_count"] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM tamper_alerts")
        stats["tamper_alerts_count"] = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM history_diffs")
        stats["history_diffs_count"] = cursor.fetchone()[0]
        
        conn.close()
        
        db_size_bytes = os.path.getsize(DB_PATH)
        stats["db_size_kb"] = db_size_bytes / 1024.0
        
    return stats


def clear_all_forensic_data() -> None:
    if not DB_PATH.exists():
        return
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("DELETE FROM permission_events")
    cursor.execute("DELETE FROM history_snapshots")
    cursor.execute("DELETE FROM tamper_alerts")
    cursor.execute("DELETE FROM history_diffs")
    
    cursor.execute("UPDATE forensic_meta SET value = '0' WHERE key = 'total_events_written'")
    cursor.execute("UPDATE forensic_meta SET value = '' WHERE key = 'last_bulk_wipe_detected'")
    
    conn.commit()
    conn.close()
