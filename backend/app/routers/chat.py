import json
import re

from fastapi import APIRouter, Depends

from app import cache
from app.config import CHAT_RULES
from app.deps import current_user
from app.errors import AppError, LLMNotConfigured
from app.services import documents, guardrails, llm, project_rag
from app.services.retrieve import format_context, retrieve, summary

router = APIRouter(tags=["chat"])

KNOWLEDGE_HITS = 12
KNOWLEDGE_CHARS = 12000
MAX_HISTORY_TURNS = 20
MAX_HISTORY_CHARS = 12000


def normalize_history(raw) -> list[dict]:
    """Keep recent user/assistant turns so follow-ups can refer to earlier answers."""
    if not isinstance(raw, list):
        return []
    turns: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        text = str(item.get("content") or item.get("text") or "").strip()
        if role not in ("user", "assistant") or not text:
            continue
        turns.append({"role": role, "content": text[:4000]})
    if len(turns) > MAX_HISTORY_TURNS:
        turns = turns[-MAX_HISTORY_TURNS:]
    total = 0
    kept: list[dict] = []
    for turn in reversed(turns):
        total += len(turn["content"])
        if total > MAX_HISTORY_CHARS and kept:
            break
        kept.append(turn)
    kept.reverse()
    return kept


def format_history(turns: list[dict]) -> str:
    if not turns:
        return ""
    lines = []
    for turn in turns:
        label = "User" if turn["role"] == "user" else "Assistant"
        lines.append(f"{label}: {turn['content']}")
    return "PREVIOUS CONVERSATION:\n" + "\n".join(lines)


@router.post("/chat")
def chat(body: dict, user: dict = Depends(current_user)):
    del user
    message = str(body.get("message") or "")
    allowed, refusal = guardrails.evaluate(message)
    if not allowed:
        return {"reply": refusal, "refused": True}
    history = normalize_history(body.get("history"))
    project_id = body.get("project_id")
    context_parts = []
    if project_id:
        for document in documents.list_documents(str(project_id)):
            context_parts.append(f"{document['name'].upper()}:\n{json.dumps(document['content_json'])[:8000]}")
        for chunk in project_rag.retrieve(project_id, message, limit=4):
            context_parts.append(f"REFERENCE {chunk['file_name']}:\n{chunk['content'][:2000]}")
    hits = retrieve(message, limit=KNOWLEDGE_HITS)
    context_parts.append(f"KNOWLEDGE BASE CONTENTS:\n{summary()}")
    context_parts.append(f"KNOWLEDGE BASE MATCHES FOR THE QUESTION:\n{format_context(hits, KNOWLEDGE_CHARS) or 'No matching entries.'}")
    history_block = format_history(history)
    if history_block:
        context_parts.append(history_block)
    # The admin-editable global prompt sets the role; the chat rules come last so they win on output format.
    system = f"{cache.get_settings()['global_system_prompt']}\n{CHAT_RULES}"
    try:
        reply = llm.complete(system, f"CONTEXT:\n{chr(10).join(context_parts)}\n\nQUESTION:\n{message}", 0.2)
    except LLMNotConfigured as exc:
        raise AppError(503, exc.detail) from exc
    return {"reply": plain_answer(reply), "refused": False}


_ANSWER_KEYS = ("answer", "reply", "response", "message", "text", "content")


def plain_answer(reply: str) -> str:
    """Models sometimes still wrap the answer as {"answer": "..."} inside a code fence; show the text only."""
    cleaned = reply.strip()
    unfenced = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.I).strip()
    try:
        data = json.loads(unfenced)
    except json.JSONDecodeError:
        return cleaned
    if isinstance(data, str):
        return data.strip()
    if isinstance(data, dict):
        for key in _ANSWER_KEYS:
            if isinstance(data.get(key), str) and data[key].strip():
                return data[key].strip()
        strings = [value for value in data.values() if isinstance(value, str) and value.strip()]
        if len(strings) == 1:
            return strings[0].strip()
    return cleaned
