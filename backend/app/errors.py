class AppError(Exception):
    def __init__(self, status: int, detail: str, errors: list[dict] | None = None) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.errors = errors


class LLMNotConfigured(AppError):
    def __init__(self) -> None:
        super().__init__(
            503,
            "Set LLM_API_KEY or add an API key under Settings > LLM to generate sections. "
            "The draft document is still available for editing.",
        )
