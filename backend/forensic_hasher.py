import hashlib
import os
import json
from pathlib import Path
from urllib.parse import urlparse

_salt: bytes | None = None
SALT_PATH = (
    Path.home() / "AppData" / "Roaming" / 
    "SensorGuard" / ".salt"
)

def get_salt() -> bytes:
    global _salt
    if _salt is not None:
        return _salt
    
    SALT_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    if SALT_PATH.exists():
        with open(SALT_PATH, "rb") as f:
            _salt = f.read()
    else:
        _salt = os.urandom(32)
        with open(SALT_PATH, "wb") as f:
            f.write(_salt)
        # Hide the file on Windows
        if os.name == 'nt':
            import subprocess
            subprocess.run(
                ["attrib", "+H", str(SALT_PATH)], 
                capture_output=True
            )
    return _salt

def normalize_domain(raw: str) -> str:
    raw = raw.strip().lower()
    if raw.startswith("chrome://") or \
       raw.startswith("edge://") or \
       raw.startswith("about:"):
        return "browser-internal"
    if raw.startswith("localhost") or \
       raw.startswith("127.0.0.1"):
        return "localhost"
    try:
        parsed = urlparse(
            raw if "://" in raw else f"https://{raw}"
        )
        domain = parsed.netloc or parsed.path
        domain = domain.split(":")[0]  # remove port
        domain = domain.lstrip("www.")
        return domain.strip("/") or "unknown"
    except Exception:
        return "unknown"

def hash_domain(domain: str) -> str:
    normalized = normalize_domain(domain)
    salt = get_salt()
    return hashlib.sha256(
        salt + normalized.encode("utf-8")
    ).hexdigest()

def hash_url(url: str) -> str:
    domain = normalize_domain(url)
    return hash_domain(domain)

def fingerprint_history(domain_hashes: list[str]) -> str:
    sorted_hashes = sorted(domain_hashes)
    joined = "|".join(sorted_hashes)
    salt = get_salt()
    return hashlib.sha256(
        salt + joined.encode("utf-8")
    ).hexdigest()

def fingerprint_permissions(
    permission_state: dict
) -> str:
    serialized = json.dumps(
        permission_state, sort_keys=True
    )
    salt = get_salt()
    return hashlib.sha256(
        salt + serialized.encode("utf-8")
    ).hexdigest()
