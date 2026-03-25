The Exact Architecture to Build
ALWAYS ON (no toggle, no consent needed):
└── Permission Snapshot Ledger (Idea 2)
    Reason: Permission changes are security metadata,
    not private content. No URL, no browsing data.
    Every user benefits. Zero privacy controversy.

OPT-IN (toggle in settings, clear disclosure):
└── History Tamper Detection (Idea 1)
    Reason: Involves hashed browsing activity.
    Security-conscious users will turn this on.
    Regular users leave it off — app still works fine.

OPT-IN ADVANCED (same toggle, shown as "what this means"):
└── Differential Storage with 7-day expiry (Idea 4)
    Reason: Gives the forensic depth the security-
    conscious user wants. Auto-expiry keeps it
    privacy-respecting even when enabled.

What the User Sees
Regular person (default state):
Tabs & Permissions
─────────────────────────────────────────
Site Permissions      ✅ 3 sites monitored
Permission Changes    ✅ Logged automatically
History Monitoring    ○  Off  [Turn on →]
Clean. Not scary. One gentle nudge to enable more.

Security-conscious person (forensic mode ON):
Tabs & Permissions
─────────────────────────────────────────
Site Permissions      ✅ 3 sites monitored
Permission Changes    ✅ 14 events logged
History Monitoring    ✅ On  [7-day retention]

⚠ TAMPER ALERT — 14:32 today
  Chrome history dropped from 847 → 12 entries
  837 entries removed in under 60 seconds
  This may indicate history tampering by a process.
  [View Details]  [Dismiss]
Same app. Same codebase. Two completely different experiences based on one toggle.

The Three-Layer Privacy Model
This is what makes it defensible to a company and trustworthy to users:
Layer 1 — Always stored (no opt-in required)
  What:  Permission change events
  Why:   Security metadata, not browsing content
  Risk:  Near zero

Layer 2 — Stored when Forensic Mode ON
  What:  History fingerprints + entry counts + diffs
  Why:   Tamper detection requires a baseline
  Risk:  Low (hashed domains, no raw URLs ever)
  Salt:  Machine-specific salt makes rainbow attacks impossible

Layer 3 — Never stored (hard boundary)
  What:  Raw URLs, page titles, actual browsing content
  Why:   This is private content, not security metadata
  Risk:  None — because it never enters SensorGuard

Build Order
Given you want all three and time is not a constraint, here is the exact sequence:
Week 1 — Foundation
Build forensic_db.py — the SQLite schema that supports all three layers. Get this right first because everything else writes to it.
Week 2 — Layer 1 (Always ON)
Build permission_ledger.py — always-on permission change logging. This is the safest, most defensible feature and gives immediate value to every user with zero privacy concern.
Week 3 — Layer 2 (Opt-in)
Build history_fingerprinter.py — the tamper detection engine. The toggle UI in settings. The TAMPER ALERT banner in the Tabs & Permissions tab.
Week 4 — Layer 2 Extension
Add differential storage with 7-day auto-expiry on top of the fingerprinter. Add the "View Details" panel that shows exactly what changed and when.
Week 5 — Frontend Polish
The forensic mode disclosure notice. The "what this means" plain-English explanation. The permission change timeline view. The tamper alert with dismiss + details flow.
