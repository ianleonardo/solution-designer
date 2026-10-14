from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import db
from app.config import jwt_secret
from app.errors import AppError

bearer = HTTPBearer(auto_error=False)


def create_token(user: dict) -> str:
    payload = {
        "sub": user["user_id"],
        "role": user["role_name"],
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
    row = db.fetchone(
        "SELECT user_id, username, email AS login_id, role_name, created_at FROM users WHERE user_id = ?",
        [payload.get("sub")],
    )
    if row is None:
        raise AppError(401, "Not authenticated")
    return row


def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role_name"] != "Admin":
        raise AppError(403, "Forbidden")
    return user
