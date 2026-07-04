"""
Functional Skills Registry for ORCHAI.

A "skill" is a selectable specialization mode. When the user activates one in the
chat input, a `[Skill: <name>]` marker is embedded into the outgoing message. The
chat router detects these markers, looks the skill up here, and injects the skill's
methodology guidance into the system prompt for that turn.

Skills are persisted to a local JSON file to allow user customization.
"""

from typing import Dict, List, Any
import json
import os

SKILLS_FILE = os.path.join(os.path.dirname(__file__), "orchai_skills.json")

DEFAULT_SKILLS: Dict[str, Dict[str, Any]] = {
    "code_review": {
        "id": "code_review",
        "label": "Code review",
        "icon": "🔍",
        "description": "Rigorous bug & quality audit",
        "injection": (
            "### ACTIVE SKILL: CODE REVIEW\n"
            "You are operating as a meticulous senior code reviewer. Follow this workflow:\n"
            "1. If a specific file or directory is referenced, use `list_directory` and `read_file` "
            "to load the actual source before commenting. NEVER review code you have not read.\n"
            "2. Analyze for: correctness bugs, edge cases, race conditions, resource leaks, "
            "error handling gaps, and security issues (injection, unsafe deserialization, secrets).\n"
            "3. Also flag reuse/simplification/efficiency opportunities, but keep them separate from bugs.\n"
            "4. Report findings as a Markdown list. Each finding MUST include: a severity tag "
            "(`[CRITICAL]`, `[HIGH]`, `[MEDIUM]`, `[LOW]`, `[NIT]`), the file:line location, "
            "a concise explanation of the impact, and a concrete suggested fix.\n"
            "5. Order findings by severity (critical first). If you find no issues in a category, say so explicitly.\n"
            "Be precise and evidence-based. Do not invent issues to pad the review."
        ),
        "enabled": True,
    },
    "security_audit": {
        "id": "security_audit",
        "label": "Security audit",
        "icon": "🛡️",
        "description": "Threat & vulnerability scan",
        "injection": (
            "### ACTIVE SKILL: SECURITY AUDIT\n"
            "You are operating as an application security auditor. Follow this workflow:\n"
            "1. Use `list_directory` and `read_file` to inspect the relevant code paths before reporting.\n"
            "2. Hunt specifically for: command/SQL/path injection, hardcoded secrets and API keys, "
            "unsafe `eval`/`exec`/deserialization, missing input validation, insecure file permissions, "
            "SSRF, unsafe subprocess usage, and overly broad CORS/auth.\n"
            "3. For each vulnerability, report: a severity (`[CRITICAL]`/`[HIGH]`/`[MEDIUM]`/`[LOW]`), "
            "the exact location, the attack scenario it enables, and a remediation.\n"
            "4. If you use `run_command` to probe, prefer read-only checks and explain why before running.\n"
            "5. End with a short prioritized remediation checklist.\n"
            "Only report issues you can substantiate from the actual code."
        ),
        "enabled": True,
    },
    "deep_research": {
        "id": "deep_research",
        "label": "Deep research",
        "icon": "🔬",
        "description": "Multi-source cited research",
        "injection": (
            "### ACTIVE SKILL: DEEP RESEARCH\n"
            "You are operating as a thorough research analyst. Follow this workflow:\n"
            "1. Decompose the question into sub-questions.\n"
            "2. Use `search_web` to find relevant sources, then `scrape_page` to read the most promising "
            "ones in full. Consult at least 2-3 independent sources before concluding.\n"
            "3. For broad, multi-step investigations, delegate to the `web-researcher` sub-agent via "
            "`delegate_to_subagent` instead of doing every step inline.\n"
            "4. Cross-check claims across sources and note any disagreement or uncertainty.\n"
            "5. Produce a structured Markdown report with clear sections and an inline source list "
            "(title + URL) for every non-trivial claim. Do not fabricate citations.\n"
            "Prioritize accuracy and recency over speed."
        ),
        "enabled": True,
    },
    "doc_writer": {
        "id": "doc_writer",
        "label": "Documentation",
        "icon": "📝",
        "description": "Generate docs from code",
        "injection": (
            "### ACTIVE SKILL: DOCUMENTATION WRITER\n"
            "You are operating as a technical documentation specialist. Follow this workflow:\n"
            "1. Use `list_directory` and `read_file` to understand the actual code/module before writing.\n"
            "2. Document: purpose/overview, public API (functions, params, return values), usage examples, "
            "configuration, and any non-obvious behavior or gotchas.\n"
            "3. Write clear, well-structured Markdown with code blocks. Match the project's existing tone.\n"
            "4. If asked to save the docs, use `write_file` to the requested path and confirm the location.\n"
            "Document only what the code actually does — never document aspirational or assumed behavior."
        ),
        "enabled": True,
    },
}

def load_skills() -> Dict[str, Dict[str, Any]]:
    """Load skills from the JSON file, or create it with defaults if it doesn't exist."""
    if not os.path.exists(SKILLS_FILE):
        _save_skills(DEFAULT_SKILLS)
        return DEFAULT_SKILLS
    
    try:
        with open(SKILLS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Ensure all skills have an 'enabled' field for backward compatibility
            for s in data.values():
                if "enabled" not in s:
                    s["enabled"] = True
            return data
    except Exception as e:
        print(f"Failed to load skills: {e}")
        return DEFAULT_SKILLS

def _save_skills(skills: Dict[str, Dict[str, Any]]):
    try:
        with open(SKILLS_FILE, 'w', encoding='utf-8') as f:
            json.dump(skills, f, indent=4)
    except Exception as e:
        print(f"Failed to save skills: {e}")

SKILLS = load_skills()

def get_public_skills() -> List[Dict[str, Any]]:
    """Return the skill catalog (without injections) for the frontend to render."""
    # The frontend needs to see enabled status now
    return [
        {
            "id": s["id"],
            "label": s["label"],
            "icon": s.get("icon", "✨"),
            "description": s["description"],
            "enabled": s.get("enabled", True),
        }
        for s in SKILLS.values()
    ]

def get_all_skills_full() -> List[Dict[str, Any]]:
    """Return all skills including injection text (for the management UI)."""
    return list(SKILLS.values())

def create_skill(skill: Dict[str, Any]) -> bool:
    if skill["id"] in SKILLS:
        return False
    
    SKILLS[skill["id"]] = {
        "id": skill["id"],
        "label": skill.get("label", skill["id"]),
        "icon": skill.get("icon", "✨"),
        "description": skill.get("description", ""),
        "injection": skill.get("injection", ""),
        "enabled": skill.get("enabled", True),
    }
    _save_skills(SKILLS)
    return True

def update_skill(skill_id: str, updates: Dict[str, Any]) -> bool:
    if skill_id not in SKILLS:
        return False
        
    s = SKILLS[skill_id]
    if "label" in updates: s["label"] = updates["label"]
    if "icon" in updates: s["icon"] = updates["icon"]
    if "description" in updates: s["description"] = updates["description"]
    if "injection" in updates: s["injection"] = updates["injection"]
    if "enabled" in updates: s["enabled"] = updates["enabled"]
    
    _save_skills(SKILLS)
    return True

def delete_skill(skill_id: str) -> bool:
    if skill_id in SKILLS:
        del SKILLS[skill_id]
        _save_skills(SKILLS)
        return True
    return False

def get_enabled_skills() -> Dict[str, Dict[str, Any]]:
    return {k: v for k, v in SKILLS.items() if v.get("enabled", True)}

def detect_active_skills(text: str) -> List[str]:
    """Find skill ids whose `[Skill: <label>]` marker appears in the given text."""
    if not text:
        return []
    lowered = text.lower()
    active: List[str] = []
    for skill in SKILLS.values():
        marker = f"[skill: {skill['label'].lower()}]"
        if marker in lowered:
            active.append(skill["id"])
    return active

def build_skill_injection(skill_ids: List[str]) -> str:
    """Concatenate the system-prompt injections for the active skills."""
    if not skill_ids:
        return ""
    parts = [
        "\n\n=== ACTIVATED SKILLS ===\n"
        "The user has explicitly activated the following specialized skill(s) for this request. "
        "Adopt their methodology and prioritize the listed tools.\n"
    ]
    for sid in skill_ids:
        skill = SKILLS.get(sid)
        if skill:
            parts.append("\n" + skill["injection"] + "\n")
    return "".join(parts)
