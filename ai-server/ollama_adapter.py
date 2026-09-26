"""
Ollama Adapter — Ollama API ile iletişim.
"""

import json
from typing import Optional, AsyncGenerator

import httpx


class OllamaAdapter:
    """Ollama REST API wrapper."""

    def __init__(self, base_url: str = "http://localhost:11434", timeout: float = 120):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url, timeout=httpx.Timeout(self.timeout)
            )
        return self._client

    async def check_connection(self) -> bool:
        try:
            client = await self._get_client()
            r = await client.get("/", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict]:
        try:
            client = await self._get_client()
            r = await client.get("/api/tags")
            data = r.json()
            return [
                {
                    "name": m["name"],
                    "size": self._format_size(m.get("size", 0)),
                    "size_bytes": m.get("size", 0),
                    "modified": m.get("modified_at", ""),
                }
                for m in data.get("models", [])
            ]
        except Exception:
            return []

    async def generate(
        self,
        model: str,
        prompt: str,
        images: list[str] | None = None,
        system: str | None = None,
        options: dict | None = None,
    ) -> dict:
        """Tek seferlik üretim (non-streaming)."""
        client = await self._get_client()
        body: dict = {
            "model": model,
            "prompt": prompt,
            "stream": False,
        }
        if images:
            body["images"] = images
        if system:
            body["system"] = system
        if options:
            body["options"] = options

        r = await client.post("/api/generate", json=body)
        data = r.json()
        return {
            "text": data.get("response", ""),
            "tokens": data.get("eval_count", 0),
            "total_duration_ms": data.get("total_duration", 0) // 1_000_000,
        }

    async def generate_stream(
        self,
        model: str,
        prompt: str,
        images: list[str] | None = None,
        system: str | None = None,
        options: dict | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Streaming üretim — her token için yield."""
        client = await self._get_client()
        body: dict = {
            "model": model,
            "prompt": prompt,
            "stream": True,
        }
        if images:
            body["images"] = images
        if system:
            body["system"] = system
        if options:
            body["options"] = options

        async with client.stream("POST", "/api/generate", json=body) as response:
            async for line in response.aiter_lines():
                if line.strip():
                    try:
                        chunk = json.loads(line)
                        yield {
                            "text": chunk.get("response", ""),
                            "done": chunk.get("done", False),
                        }
                    except json.JSONDecodeError:
                        continue

    async def chat(
        self,
        model: str,
        messages: list[dict],
        options: dict | None = None,
    ) -> dict:
        """Chat API — çoklu mesaj desteği."""
        client = await self._get_client()
        body: dict = {
            "model": model,
            "messages": messages,
            "stream": False,
        }
        if options:
            body["options"] = options

        r = await client.post("/api/chat", json=body)
        data = r.json()
        msg = data.get("message", {})
        return {
            "text": msg.get("content", ""),
            "tokens": data.get("eval_count", 0),
        }

    async def pull_model(self, name: str) -> AsyncGenerator[dict, None]:
        """Model indir — streaming progress."""
        client = await self._get_client()
        async with client.stream("POST", "/api/pull", json={"name": name}) as response:
            async for line in response.aiter_lines():
                if line.strip():
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    @staticmethod
    def _format_size(size_bytes: int) -> str:
        if size_bytes <= 0:
            return "?"
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024
        return f"{size_bytes:.1f} TB"
