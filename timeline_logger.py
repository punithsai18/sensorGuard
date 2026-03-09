import sqlite3
import os
import logging
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "screen_time.db")
logger = logging.getLogger("TimelineLogger")

def log_event(event_type, event_source, event_detail):
    """
    Logs an event to the timeline_events table in screen_time.db
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        now_str = datetime.now().isoformat()
        conn.execute("""
            INSERT INTO timeline_events (timestamp, event_type, event_source, event_detail)
            VALUES (?, ?, ?, ?)
        """, (now_str, event_type, event_source, event_detail))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to log timeline event ({event_type}): {e}")
