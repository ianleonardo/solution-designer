import re

REFUSAL = (
    "I can only help with IT system solutioning and architecture, including this project's documents and the knowledge base."
)

_INJECTION = [
    re.compile(r"ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+(instructions|prompts)", re.I),
    re.compile(r"disregard\s+(the\s+|all\s+)?(system|previous)", re.I),
    re.compile(r"reveal\s+(the\s+|your\s+)?(system\s+)?prompt", re.I),
    re.compile(r"you are now", re.I),
    re.compile(r"\bjailbreak\b", re.I),
    re.compile(r"do anything now", re.I),
    re.compile(r"forget\s+(all\s+)?your\s+instructions", re.I),
    re.compile(r"<\s*script", re.I),
]
_UNETHICAL = [
    re.compile(r"\b(exploit|malware|phishing|ransomware)\b", re.I),
    re.compile(r"how to\s+(hack|steal|break into)", re.I),
    re.compile(r"\b(steal|dump)\s+passwords?\b", re.I),
]
_OFF_TOPIC = [
    re.compile(r"\b(weather|recipe|celebrity|horoscope|sports score)\b", re.I),
    re.compile(r"\b(write a poem|tell me a joke)\b", re.I),
]
_DOMAIN = re.compile(
    r"\b(design|interface|nfr|requirement|database|deployment|sequence|capability|report|"
    r"architecture|sdd|flow|security|resilien|failover|timeout|table|api|component|use case|"
    r"project|inventory|baseline|diagram|recovery|housekeep|volumetric|auth|solution|section|"
    r"document|repo|guideline|system|data|integration|approve|maker|checker)\b",
    re.I,
)
# General IT and architecture vocabulary. Whole words, plus a few stems that cover their variants.
_IT_TOPIC = re.compile(
    r"\b(microservices?|monoliths?|cloud|kubernetes|docker|containers?|latency|throughput|"
    r"encrypt\w*|oauth|sso|tokens?|queues?|kafka|events?|cache|caching|monitoring|observability|"
    r"logging|cicd|devops|networks?|performance|compliance|migrations?|servers?|backend|frontend|"
    r"infrastructure|clusters?|backup|soap|graphql|sql|schema|batch|software|applications?|"
    r"services?|code|coding|secure|patterns?|technical|technology|stack|scal\w*|availab\w*|"
    r"messag\w*|load balanc\w*|disaster|devsecops|vulnerabilit\w*|authenticat\w*|authoriz\w*)\b",
    re.I,
)


def evaluate(message: str) -> tuple[bool, str]:
    text = (message or "").strip()
    if not text:
        return False, "Enter a question about IT solutioning or architecture."
    if len(text) > 4000:
        return False, "That question is too long. Ask about a specific topic, section or inventory item."
    if any(pattern.search(text) for pattern in _INJECTION):
        return False, REFUSAL
    if any(pattern.search(text) for pattern in _UNETHICAL):
        return False, REFUSAL
    if any(pattern.search(text) for pattern in _OFF_TOPIC):
        return False, REFUSAL
    if _DOMAIN.search(text) or _IT_TOPIC.search(text) or len(text.split()) <= 8:
        return True, ""
    return False, REFUSAL
