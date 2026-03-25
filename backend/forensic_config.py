import json
from pathlib import Path

CONFIG_PATH = (
    Path.home() / "AppData" / "Roaming" / 
    "SensorGuard" / "forensic_config.json"
)

DEFAULT_CONFIG = {
    # Layer 1 — always on, not user-configurable
    "permission_ledger_enabled": True,
    
    # Layer 2 — user opt-in
    "history_tamper_detection_enabled": False,
    
    # Layer 3 — user opt-in (requires Layer 2)
    "differential_storage_enabled": False,
    
    # Retention settings
    "diff_retention_days": 7,
    "snapshot_retention_days": 30,
    "alert_retention_days": 90,
    
    # Scan interval for history fingerprinting (seconds)
    "fingerprint_scan_interval": 60,
    
    # Alert thresholds
    # How many entries must be removed in one scan 
    # to trigger a BULK_WIPE alert
    "bulk_wipe_threshold": 50,
    
    # Percentage drop that triggers SUSPICIOUS_DROP
    "suspicious_drop_percentage": 30,
    
    # User consent recorded
    "forensic_consent_given": False,
    "forensic_consent_timestamp": None,
}

def load_config() -> dict:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH) as f:
                stored = json.load(f)
            # Merge with defaults (handles new keys added in updates)
            return {**DEFAULT_CONFIG, **stored}
        except Exception:
            return DEFAULT_CONFIG.copy()
    return DEFAULT_CONFIG.copy()

def save_config(config: dict):
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)

def update_setting(key: str, value) -> dict:
    config = load_config()
    config[key] = value
    save_config(config)
    return config

def is_layer1_enabled() -> bool:
    return True  # always on, hardcoded

def is_layer2_enabled() -> bool:
    return load_config().get(
        "history_tamper_detection_enabled", False
    )

def is_layer3_enabled() -> bool:
    cfg = load_config()
    return (
        cfg.get("differential_storage_enabled", False)
        and cfg.get(
            "history_tamper_detection_enabled", False
        )
    )
