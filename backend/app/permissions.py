"""Role-based access: each role gives none / read / write on three areas.

  projects   - Project Documents (projects, their documents, references and images)
  knowledge  - Knowledge Base (systems, capabilities, interfaces, tables, batches, reports, guidelines, repos, inventory)
  settings   - Settings (LLM, document layouts, users, user roles, audit log)

"none" hides the area, "read" shows it without changes, "write" allows add / edit / delete as well.
Every API request is checked here by its path and method (see `rule_for`), so a route cannot be missed;
services repeat the write checks for the actions they perform.
"""

import re

from app.errors import AppError

AREAS = ("projects", "knowledge", "settings")
LEVELS = {"none": 0, "read": 1, "write": 2}

ADMIN_ROLE_ID = "administrator"
PREDEFINED_ROLES = [
    {
        "role_id": "viewer",
        "name": "Viewer",
        "description": "Views projects and the Knowledge Base.",
        "projects": "read",
        "knowledge": "read",
        "settings": "none",
    },
    {
        "role_id": "analyst",
        "name": "Analyst",
        "description": "Writes projects; views the Knowledge Base.",
        "projects": "write",
        "knowledge": "read",
        "settings": "none",
    },
    {
        "role_id": "super-analyst",
        "name": "Super-analyst",
        "description": "Writes projects and the Knowledge Base.",
        "projects": "write",
        "knowledge": "write",
        "settings": "none",
    },
    {
        "role_id": ADMIN_ROLE_ID,
        "name": "Administrator",
        "description": "Can do everything, including settings.",
        "projects": "write",
        "knowledge": "write",
        "settings": "write",
    },
]
# Role names stored on users before roles became configurable.
LEGACY_ROLES = {
    "Admin": ADMIN_ROLE_ID,
    "Analyst": "analyst",
    "Viewer": "viewer",
    "Maker": "analyst",
    "Checker": "analyst",
    "Write": "analyst",
    "Read": "viewer",
}


def permissions_of(row: dict | None) -> dict[str, str]:
    return {area: (row or {}).get(area) if (row or {}).get(area) in LEVELS else "none" for area in AREAS}


def can(user: dict, area: str, need: str = "read") -> bool:
    level = (user.get("permissions") or {}).get(area, "none")
    return LEVELS.get(level, 0) >= LEVELS[need]


def require(user: dict, area: str, need: str = "read") -> None:
    if not can(user, area, need):
        raise AppError(403, "Forbidden")


# --- which area and level a request needs --------------------------------------------------------------------------

_KNOWLEDGE = {"rag", "guidelines", "systems", "interfaces", "tables", "reports", "batches", "bitbucket-repos", "capabilities"}
_SETTINGS = {"templates", "layouts", "settings", "audit", "reindex", "users", "roles"}
# POSTs that only read: checking a document for gaps, and listing related Knowledge Base items.
_READ_POSTS = re.compile(r"^projects/[^/]+(?:/documents/[^/]+)?/(?:validate|sections/[^/]+/kb-related)$")
_KB_LINKS = re.compile(r"^projects/[^/]+/documents/[^/]+/sections/[^/]+/kb-(?:links|refresh|related)$")


def rule_for(method: str, path: str) -> list[list[tuple[str, str]]]:
    """What a request needs: a list of requirements that must all hold, each met by any one (area, level) option.

    An empty list means any signed-in user may make it.
    """
    route = path.split("/api/", 1)[-1].strip("/")
    first = route.split("/", 1)[0]
    reading = method in ("GET", "HEAD", "OPTIONS")
    if first == "projects":
        needs = [[("projects", "read" if reading or _READ_POSTS.match(route) else "write")]]
        if _KB_LINKS.match(route):
            needs.append([("knowledge", "read")])  # these read the Knowledge Base into the document
        return needs
    if first in _KNOWLEDGE:
        if reading and first == "systems":
            return []  # the system list is a catalogue of codes, used by project scope too
        return [[("knowledge", "read" if reading else "write")]]
    if first in _SETTINGS:
        if reading and route in ("layouts", "templates"):
            return [[("projects", "read"), ("settings", "read")]]  # documents are added from layouts
        return [[("settings", "read" if reading else "write")]]
    return []  # dashboard, catalogs, chat, health


def check_request(user: dict, method: str, path: str) -> None:
    for options in rule_for(method, path):
        if not any(can(user, area, level) for area, level in options):
            raise AppError(403, "Forbidden")
