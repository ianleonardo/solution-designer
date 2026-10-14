from fastapi import APIRouter, Depends

from app.deps import create_token, current_user
from app.services import projects

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
def login(body: dict):
    user = projects.authenticate(str(body.get("login_id") or body.get("email") or ""), str(body.get("password") or ""))
    return {"access_token": create_token(user), "user": user}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user
