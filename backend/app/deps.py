from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import db
from app.config import jwt_secret
from app.errors import AppError
from app.permissions import check_request, permissions_of, require

bearer = HTTPBearer(auto_error=False)


def create_token(user: dict) -> str:
    payload = {
        "sub": user["user_id"],
        "role": user.get("role_id") or user["role_name"],
        "login_id": user["login_id"],
        "exp": datetime.now(timezone.utc) + timedelta(hours=12),
    }
    return jwt.encode(payload, jwt_secret(), algorithm="HS256")


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "Not authenticated")
    try:
        payload = jwt.decode(credentials.credentials, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise AppError(401, "Not authenticated") from exc
    return load_user(payload.get("sub"))


def load_user(user_id) -> dict:
    """The signed-in user with their role's name and permissions."""
    row = db.fetchone(
        """
        SELECT u.user_id, u.username, u.email AS login_id, u.role_name AS role_id, u.created_at,
               r.name AS role_display, r.projects, r.knowledge, r.settings
        FROM users u LEFT JOIN roles r ON r.role_id = u.role_name
        WHERE u.user_id = ?
        """,
        [user_id],
    )
    if row is None:
        raise AppError(401, "Not authenticated")
    return {
        "user_id": row["user_id"],
        "username": row["username"],
        "login_id": row["login_id"],
        "role_id": row["role_id"],
        "role_name": row["role_display"] or row["role_id"],
        "permissions": permissions_of(row),
        "created_at": row["created_at"],
    }


def enforce_access(request: Request, user: dict = Depends(current_user)) -> dict:
    """Router-wide check: the request's area and level (from its path and method) against the user's role."""
    check_request(user, request.method, request.url.path)
    return user


def require_admin(request: Request, user: dict = Depends(current_user)) -> dict:
    """Settings: reading needs settings read, changing needs settings write."""
    require(user, "settings", "read" if request.method in ("GET", "HEAD") else "write")
    return user


def require_kb_editor(user: dict = Depends(current_user)) -> dict:
    require(user, "knowledge", "write")
    return user
