import os
import json
import time
import logging
import sqlite3
from typing import Dict, Any, List

logger = logging.getLogger("orchai.rules_engine")

class RulesEngine:
    """
    A pure Python wrapper-level rules engine that executes heuristics locally.
    Bypasses LLM latency to handle state transitions, track behavioral errors,
    and populate self-model observations.
    """
    def __init__(self, config_path: str = None):
        self.config_path = config_path or os.path.join(os.path.dirname(__file__), "rules_config.json")
        self.state: str = "CONVERSING"  # Default active state: CONVERSING, DEBUGGING, STUCK, IDLE
        self.consecutive_failures: int = 0
        self.edit_count: int = 0
        self.last_edit_time: float = 0.0
        self.rules: List[Dict[str, Any]] = []
        self._load_config()

    def _load_config(self):
        # Default fallback rules
        self.rules = [
            {
                "rule_name": "consecutive_shell_failures",
                "trigger_threshold": 3,
                "target_state": "DEBUGGING",
                "message": "User has experienced multiple consecutive terminal command failures. Activating debugging mode."
            },
            {
                "rule_name": "rapid_file_edits",
                "trigger_threshold": 5,
                "time_window_seconds": 60,
                "target_state": "REFLECTIVE",
                "message": "User is performing rapid edits in a short window. I should offer architectural overview support."
            }
        ]
        
        # Load from config if available
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "rules" in data:
                        self.rules = data["rules"]
                        logger.info(f"Loaded {len(self.rules)} rules from config.")
            except Exception as e:
                logger.error(f"Failed to load rules config: {e}")
        else:
            # Save default config
            try:
                os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
                with open(self.config_path, "w", encoding="utf-8") as f:
                    json.dump({"rules": self.rules}, f, indent=4)
            except Exception as e:
                logger.error(f"Failed to save default rules config: {e}")

    def evaluate_rules(self, orch, last_user_query: str):
        """
        Evaluate local query heuristics and tool logs.
        Transitions state and updates self_model database entries directly.
        """
        session_id = orch.session_id
        db_path = orch.db_path
        
        # 1. Analyze tool failures in the message log
        # Look at the last few messages in memory for failed tool calls
        failures = 0
        for msg in reversed(orch._messages[-6:]):
            if msg["role"] == "tool":
                content = (msg.get("content") or "").lower()
                # Check for common terminal or tool error phrases
                if "error" in content or "fail" in content or "exit code" in content or "exception" in content:
                    failures += 1
                else:
                    # Successful tool call breaks the consecutive chain
                    break
        self.consecutive_failures = failures

        # 2. Evaluate rules
        triggered_state = "CONVERSING"
        triggered_msg = ""
        
        for rule in self.rules:
            if rule["rule_name"] == "consecutive_shell_failures":
                if self.consecutive_failures >= rule["trigger_threshold"]:
                    triggered_state = rule["target_state"]
                    triggered_msg = rule["message"]
                    break
                    
        # Update state
        if triggered_state != self.state:
            logger.info(f"State transition: {self.state} -> {triggered_state}. Reason: {triggered_msg}")
            self.state = triggered_state
            
            # Write wrapper-level observation directly to self_model table without LLM involvement!
            try:
                with sqlite3.connect(db_path) as conn:
                    log_id = f"sm-{int(time.time() * 1000)}"
                    conn.execute(
                        "INSERT OR REPLACE INTO self_model (id, session_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (log_id, session_id, "active_state_behavior", f"I transitioned to {self.state} mode. {triggered_msg}", time.time())
                    )
                    conn.commit()
            except Exception as db_err:
                logger.error(f"RulesEngine failed to update self_model: {db_err}")
                
        # 3. Add dynamic wrapper suggestions if state is degraded
        if self.state == "DEBUGGING":
            orch.sensory_context = (orch.sensory_context or "") + "\n[System Warning: Consecutive tool/terminal failures detected. System is in DEBUGGING mode. Offer explicit syntax details, double-check file paths, and suggest verification commands.]\n"

# Singleton or factory mapping for engines per session
_session_engines: Dict[str, RulesEngine] = {}

def get_rules_engine(session_id: str) -> RulesEngine:
    if session_id not in _session_engines:
        _session_engines[session_id] = RulesEngine()
    return _session_engines[session_id]
