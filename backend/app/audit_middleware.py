"""Writes an audit entry for every request that changes data (and for document exports).

It is a plain ASGI middleware so it can see the matched route, the signed-in user, the request body and the status
of the response. Only requests that succeeded are recorded; failed sign-ins are recorded by the login route.
"""

import json
import re

import jwt
from starlette.concurrency import run_in_threadpool
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import db
from app.config import jwt_secret
from app.services import audit

CHANGING = {"POST", "PUT", "PATCH", "DELETE"}
# Reads that are worth a trace: a document leaving the system.
AUDITED_READS = {"export_document"}
# Changing requests that do not change anything.
IGNORED = {"login", "chat"}
JSON_LIMIT = 1_000_000
UPLOAD_LIMIT = 16_000
RESPONSE_LIMIT = 64_000
FILENAME = re.compile(rb'filename="([^"]{1,200})"')


def _header(scope: Scope, name: bytes) -> str:
    for key, value in scope.get("headers", []):
        if key == name:
            return value.decode("latin-1")
    return ""


def _signed_in(scope: Scope) -> dict | None:
    header = _header(scope, b"authorization")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    row = db.fetchone(
        "SELECT user_id, username, email AS login_id, role_name FROM users WHERE user_id = ?", [claims.get("sub")]
    )
    return row or {"user_id": claims.get("sub"), "username": None, "login_id": claims.get("login_id"), "role_name": claims.get("role")}


def _request_detail(content_type: str, body: bytes, truncated: bool) -> dict | None:
    if "multipart/form-data" in content_type:
        match = FILENAME.search(body)
        return {"file": match.group(1).decode("utf-8", "replace")} if match else None
    if "json" in content_type and body and not truncated:
        try:
            parsed = json.loads(body)
        except ValueError:
            return None
        return audit.sanitize(parsed) if isinstance(parsed, dict) else None
    return None


def _json_object(raw: bytes) -> dict | None:
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _write(scope: Scope, status: int, request: dict, response_body: bytes) -> None:
    route = scope.get("route")
    name = getattr(route, "name", None)
    method = scope["method"]
    if route is None or not name or name in IGNORED or status >= 400:
        return
    if method == "GET" and name not in AUDITED_READS:
        return
    path_params = scope.get("path_params", {})
    response = _json_object(response_body) if response_body else None
    entity_type, entity_id = audit.describe_route(route.path_format, path_params, response)
    body = request["detail"] if isinstance(request["detail"], dict) else None
    project_name = None
    project_id = path_params.get("project_id")
    if project_id:
        found = db.fetchone("SELECT project_name FROM projects WHERE project_id = ?", [project_id])
        project_name = found["project_name"] if found else None
    file_name = {"name": body["file"]} if body and isinstance(body.get("file"), str) else None
    label = audit.label_of(body, response, file_name)
    summary = audit.humanize(name)
    if label:
        summary += f": {label}"
    if project_name and project_name != label:
        summary += f" (project {project_name})"
    detail: dict = {}
    if project_id:
        detail["project_id"] = project_id
    if request["detail"]:
        detail["request"] = request["detail"]
    if method == "GET":
        detail["query"] = scope.get("query_string", b"").decode("latin-1")
    audit.record(
        action=name,
        summary=summary,
        user=_signed_in(scope),
        method=method,
        path=scope["path"],
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail or None,
        ip_address=(scope.get("client") or (None,))[0],
    )


class AuditMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        method = scope.get("method")
        if scope["type"] != "http" or (method not in CHANGING and method != "GET") or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        content_type = _header(scope, b"content-type").lower()
        limit = UPLOAD_LIMIT if "multipart" in content_type else JSON_LIMIT
        chunks: list[bytes] = []
        state = {"size": 0, "truncated": False, "status": 0, "json": False}
        reply: list[bytes] = []

        async def tracked_receive() -> Message:
            message = await receive()
            if message["type"] == "http.request":
                data = message.get("body", b"")
                room = limit - state["size"]
                if len(data) > room:
                    state["truncated"] = True
                if room > 0:
                    chunks.append(data[:room])
                    state["size"] += min(len(data), room)
            return message

        async def tracked_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                state["status"] = message["status"]
                headers = {key.lower(): value for key, value in message.get("headers", [])}
                state["json"] = b"application/json" in headers.get(b"content-type", b"")
            elif message["type"] == "http.response.body" and state["json"] and sum(map(len, reply)) < RESPONSE_LIMIT:
                reply.append(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, tracked_receive, tracked_send)
        finally:
            if state["status"] and state["status"] < 400:
                request = {"detail": _request_detail(content_type, b"".join(chunks), bool(state["truncated"]))}
                response_body = b"".join(reply) if sum(map(len, reply)) < RESPONSE_LIMIT else b""
                await run_in_threadpool(_write, scope, state["status"], request, response_body)
