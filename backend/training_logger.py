"""
SensorGuard — Training Data Logger
====================================
Logs every AI risk assessment to a SQLite database so the data
can later be used to train an offline ML model (Random Forest
+ ONNX) that replaces the API calls in Phase 2.
"""

import sqlite3
import json
import os
import csv
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DB_PATH = os.getenv("TRAINING_DB_PATH", "data/training_data.db")


def init_training_db():
    """Create the training_samples table if it doesn't exist."""
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS training_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            sensor_type TEXT,
            process_name TEXT,
            is_known_process INTEGER,
            is_foreground INTEGER,
            user_idle_seconds INTEGER,
            simultaneous_sensors TEXT,
            simultaneous_count INTEGER,
            access_duration_seconds INTEGER,
            first_seen_today INTEGER,
            hour_of_day INTEGER,
            is_business_hours INTEGER,
            is_background_access INTEGER,
            is_multi_sensor_event INTEGER,
            is_suspicious_time INTEGER,
            has_website INTEGER,
            ai_risk_level TEXT,
            ai_risk_score INTEGER,
            ai_likelihood INTEGER,
            ai_impact INTEGER,
            ai_confidence REAL,
            ai_is_false_positive INTEGER,
            ai_mitre_technique TEXT,
            ai_reasoning TEXT,
            model_used TEXT,
            was_fallback INTEGER DEFAULT 0,
            full_context_json TEXT,
            full_response_json TEXT,
            human_label TEXT DEFAULT NULL,
            human_reviewed INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()


def log_assessment(assessment: dict):
    """Insert a single AI risk assessment into the training database."""
    ctx = assessment.get("_context", {})
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        INSERT INTO training_samples VALUES (
            NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
            ?,?,?,?,?,?,?,?,?,?,?,?,NULL,0
        )
        """,
        (
            ctx.get("timestamp"),
            ctx.get("sensor_type"),
            ctx.get("process_name"),
            int(ctx.get("is_known_process", False)),
            int(ctx.get("is_foreground", False)),
            ctx.get("user_idle_seconds", 0),
            json.dumps(ctx.get("simultaneous_sensors", [])),
            ctx.get("simultaneous_sensor_count", 0),
            ctx.get("access_duration_seconds", 0),
            int(ctx.get("first_seen_today", False)),
            ctx.get("hour_of_day", 0),
            int(ctx.get("is_business_hours", True)),
            int(ctx.get("is_background_access", False)),
            int(ctx.get("is_multi_sensor_event", False)),
            int(ctx.get("is_suspicious_time", False)),
            int(bool(ctx.get("website"))),
            assessment.get("risk_level"),
            assessment.get("risk_score"),
            assessment.get("likelihood"),
            assessment.get("impact"),
            assessment.get("confidence"),
            int(assessment.get("is_false_positive", False)),
            assessment.get("mitre_technique"),
            assessment.get("reasoning"),
            assessment.get("_model"),
            int(assessment.get("_fallback", False)),
            json.dumps(ctx),
            json.dumps(
                {k: v for k, v in assessment.items() if not k.startswith("_")}
            ),
        ),
    )
    conn.commit()
    conn.close()


def export_for_training(output_path="data/training_export.csv"):
    """
    Export high-confidence, non-fallback assessments as a CSV
    suitable for training a Random Forest classifier.
    Returns the number of rows exported.
    """
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        """
        SELECT sensor_type, is_known_process, is_foreground,
               user_idle_seconds, simultaneous_count,
               access_duration_seconds, first_seen_today,
               hour_of_day, is_business_hours,
               is_background_access, is_multi_sensor_event,
               is_suspicious_time, has_website,
               ai_risk_level, ai_risk_score
        FROM training_samples
        WHERE was_fallback = 0
          AND ai_confidence >= 0.7
        ORDER BY timestamp DESC
        """
    ).fetchall()
    conn.close()

    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "sensor_type",
                "is_known_process",
                "is_foreground",
                "user_idle_seconds",
                "simultaneous_count",
                "access_duration_seconds",
                "first_seen_today",
                "hour_of_day",
                "is_business_hours",
                "is_background_access",
                "is_multi_sensor_event",
                "is_suspicious_time",
                "has_website",
                "risk_level",
                "risk_score",
            ]
        )
        writer.writerows(rows)

    return len(rows)
