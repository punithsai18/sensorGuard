"""
SensorGuard — AI Risk Agent (OpenRouter)
========================================
Uses the OpenAI-compatible OpenRouter API to evaluate
sensor access events and return intelligent risk scores with
plain-English reasoning.
"""

import json
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# OpenRouter uses the OpenAI-compatible interface 
client = OpenAI(
    api_key=os.getenv("OPENROUTER_API_KEY"),
    base_url="https://openrouter.ai/api/v1",
)

SYSTEM_PROMPT = """
You are a cybersecurity risk assessment engine for SensorGuard,
a real-time desktop sensor monitoring application for Windows.

You receive a JSON object describing a hardware sensor access
event on a Windows machine. Assess whether it represents
legitimate use or a security threat.

KNOWN LEGITIMATE PROCESSES:
chrome.exe, msedge.exe, brave.exe, firefox.exe, zoom.exe,
ms-teams.exe, slack.exe, discord.exe, skype.exe, obs64.exe,
vlc.exe, spotify.exe, code.exe, explorer.exe

RISK SCORING RULES:
LOW (score 1-6):
  - Known process using sensor for its clear purpose
  - User is actively using the app (low idle time)
  - App is in foreground
  - Example: chrome.exe + camera + meet.google.com = video call

MEDIUM (score 7-14):
  - Known process but unexpected sensor combination
  - Brief background access with plausible explanation
  - Example: spotify.exe accessing microphone briefly

HIGH (score 15-19):
  - Unknown or unrecognized process name
  - User idle > 30 seconds with background sensor access
  - First time this process has touched this sensor

CRITICAL (score 20-25):
  - Unknown process + multiple sensors simultaneously
  - Any sensor access between midnight and 6 AM
  - Background access with no visible window > 5 minutes
  - Example: unknown.exe accessing camera + clipboard
    while user idle at 3 AM

CRITICAL RULE: Same sensor = different risk depending on
context. Google Meet camera = LOW. Unknown process camera
at 3 AM = CRITICAL.

Return ONLY raw valid JSON. No markdown. No code blocks.
No explanation outside the JSON object.

Required JSON fields:
{
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "risk_score": <integer 1-25>,
  "likelihood": <integer 1-5>,
  "impact": <integer 1-5>,
  "confidence": <float 0.0-1.0>,
  "reasoning": "<2-3 sentences plain English>",
  "mitre_technique": "<T-code and name, or null>",
  "recommended_action": "<one sentence>",
  "is_false_positive": <true or false>
}
"""

FALLBACK_SCORES = {
    "camera": {
        "risk_level": "HIGH",
        "risk_score": 16,
        "likelihood": 4,
        "impact": 5,
        "confidence": 0.5,
        "reasoning": "API unavailable — conservative HIGH risk for camera access.",
        "mitre_technique": "T1125 - Video Capture",
        "recommended_action": "Verify which application is accessing the camera.",
        "is_false_positive": False,
    },
    "microphone": {
        "risk_level": "HIGH",
        "risk_score": 15,
        "likelihood": 3,
        "impact": 5,
        "confidence": 0.5,
        "reasoning": "API unavailable — conservative HIGH risk for microphone access.",
        "mitre_technique": "T1123 - Audio Capture",
        "recommended_action": "Verify which application is accessing the microphone.",
        "is_false_positive": False,
    },
    "clipboard": {
        "risk_level": "MEDIUM",
        "risk_score": 10,
        "likelihood": 2,
        "impact": 5,
        "confidence": 0.5,
        "reasoning": "API unavailable — MEDIUM risk default for clipboard access.",
        "mitre_technique": "T1115 - Clipboard Data",
        "recommended_action": "Monitor clipboard access pattern.",
        "is_false_positive": False,
    },
}


def assess_risk(context: dict) -> dict:
    """
    Send the sensor context to OpenRouter for risk assessment.
    Falls back to conservative static scores on any failure.
    """
    try:
        response = client.chat.completions.create(
            model=os.getenv("RISK_AGENT_MODEL", "nvidia/nemotron-3-super-120b-a12b:free"),
            max_tokens=int(os.getenv("RISK_AGENT_MAX_TOKENS", "400")),
            temperature=0,
            timeout=float(os.getenv("RISK_AGENT_TIMEOUT_SECONDS", "8")),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": json.dumps(context, indent=2),
                },
            ],
        )

        raw = response.choices[0].message.content.strip()
        print(f"DEBUG: OpenRouter Response received ({len(raw)} chars)")

        # Handle models that wrap JSON in markdown blocks
        if "```" in raw:
            parts = raw.split("```")
            raw = parts[1] if len(parts) > 1 else raw
            if raw.lower().startswith("json"):
                raw = raw[4:].strip()

        # Fallback: extract substring between the first { and last }
        start_idx = raw.find('{')
        end_idx = raw.rfind('}')
        if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
            raw = raw[start_idx:end_idx+1]

        assessment = json.loads(raw)
        assessment["_context"] = context
        assessment["_model"] = os.getenv("RISK_AGENT_MODEL")
        assessment["_timestamp"] = context["timestamp"]

        return assessment

    except json.JSONDecodeError as e:
        print(f"DEBUG: JSONDecodeError in assess_risk: {e}\nRaw output: {raw[:200]}...")
        sensor = context.get("sensor_type", "unknown")
        fallback = FALLBACK_SCORES.get(sensor, {
            "risk_level": "MEDIUM",
            "risk_score": 10,
            "likelihood": 3,
            "impact": 3,
            "confidence": 0.5,
            "reasoning": f"API unavailable (JSON Error) — generic MEDIUM risk default for {sensor} access.",
            "mitre_technique": None,
            "recommended_action": f"Monitor {sensor} activity.",
            "is_false_positive": False,
        }).copy()
        fallback["_context"] = context
        fallback["_fallback"] = True
        return fallback

    except Exception as e:
        print(f"DEBUG: API Error in assess_risk: {e}")
        import traceback
        traceback.print_exc()
        sensor = context.get("sensor_type", "unknown")
        fallback = FALLBACK_SCORES.get(sensor, {
            "risk_level": "MEDIUM",
            "risk_score": 10,
            "likelihood": 3,
            "impact": 3,
            "confidence": 0.5,
            "reasoning": f"API unavailable ({type(e).__name__}: {str(e)}) — generic MEDIUM risk default for {sensor} access.",
            "mitre_technique": None,
            "recommended_action": f"Monitor {sensor} activity.",
            "is_false_positive": False,
        }).copy()
        fallback["_context"] = context
        fallback["_fallback"] = True
        fallback["_error"] = str(e)
        return fallback
