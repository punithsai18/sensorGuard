import sqlite3
import os
import logging
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "screen_time.db")
logger = logging.getLogger("TimelineLogger")

def init_db():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS timeline_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                event_type TEXT,
                event_source TEXT,
                event_detail TEXT
            )
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to initialize timeline database: {e}")

def log_event(event_type, event_source, event_detail):
    """
    Logs an event to the timeline_events table in screen_time.db
    """
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        now_str = datetime.now().isoformat()
        conn.execute("""
            INSERT INTO timeline_events (timestamp, event_type, event_source, event_detail)
            VALUES (?, ?, ?, ?)
        """, (now_str, event_type, event_source, event_detail))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error(f"Failed to log timeline event ({event_type}): {e}")

async def main():
    import websockets
    from websockets.http11 import Response
    from websockets.datastructures import Headers
    import asyncio

    init_db()
    log_event("SYSTEM", "Service", "Timeline Logger service started")

    async def register(websocket):
        try:
            await websocket.wait_closed()
        finally:
            pass

    async def process_request(connection, request):
        if request.headers.get("Upgrade", "").lower() != "websocket":
            return Response(200, "OK", Headers([("Content-Type", "text/html"), ("Connection", "close")]), b"Timeline Logger Active")
        return None

    async with websockets.serve(register, "127.0.0.1", 9000, process_request=process_request):
        logger.info("Timeline Logger service running on ws://127.0.0.1:9000")
        await asyncio.Future()

if __name__ == "__main__":
    import asyncio
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
