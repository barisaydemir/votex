"""
VOTEX AI Server — Yerel yapay zeka modelleri için FastAPI servisi.

Özellikler:
  - Ollama entegrasyonu (LLM, vision)
  - llama.cpp server desteği
  - Özel PyTorch model desteği
  - Model indirme/yönetme
  - VOTEX ile WebSocket + REST entegrasyonu

Kullanım:
  python server.py                    # Varsayılan: 8080 portu
  python server.py --port 9090        # Özel port
  python server.py --ollama http://localhost:11434  # Ollama URL
"""

import asyncio
import argparse
import base64
import io
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

# ── AI Backend Adapters ────────────────────────────────────
from ollama_adapter import OllamaAdapter
from model_manager import ModelManager

# ── App ────────────────────────────────────────────────────
app = FastAPI(title="VOTEX AI Server", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state
manager = ModelManager()
ollama: Optional[OllamaAdapter] = None


# ── Models ─────────────────────────────────────────────────
class AnalyzeImageRequest(BaseModel):
    image_base64: str
    prompt: str = "Bu manyetik/harita görselinde yeraltı yapılarını analiz et. Odalar, tüneller, metal tespitleri ve su kaynaklarını belirle."
    model: Optional[str] = None
    max_tokens: int = 1024


class AnalyzeImageResponse(BaseModel):
    text: str
    model_used: str
    tokens_used: int = 0
    latency_ms: int = 0


class DetectAnomalyRequest(BaseModel):
    """Manyetik anomali tespiti için istek."""
    data_points: list[dict]  # [{x, y, z, bx, by, bz}, ...]
    context: str = ""
    model: Optional[str] = None


class DetectAnomalyResponse(BaseModel):
    detections: list[dict]
    summary: str
    model_used: str
    latency_ms: int = 0


class GenerateReportRequest(BaseModel):
    """Analiz raporu oluşturmak için istek."""
    structures: list[dict]
    surface_info: dict
    language: str = "tr"
    model: Optional[str] = None


class GenerateReportResponse(BaseModel):
    report: str
    model_used: str
    latency_ms: int = 0


class ChatRequest(BaseModel):
    message: str
    context: str = ""
    model: Optional[str] = None
    stream: bool = False


class ModelInfo(BaseModel):
    name: str
    type: str  # llm, vision, embedding
    size: str
    loaded: bool = False
    backend: str  # ollama, llamacpp, pytorch


class ServerStatus(BaseModel):
    status: str
    ollama_connected: bool
    models_loaded: int
    models_available: list[ModelInfo]
    uptime_seconds: float


# ── Startup ────────────────────────────────────────────────
@app.on_event("startup")
async def startup():
    global ollama
    ollama_url = os.environ.get("OLLAMA_URL", "http://localhost:11434")
    ollama = OllamaAdapter(ollama_url)
    connected = await ollama.check_connection()
    print(f"[VOTEX AI] Ollama: {'✓ connected' if connected else '✗ not found'} ({ollama_url})")
    if connected:
        models = await ollama.list_models()
        print(f"[VOTEX AI] Models: {', '.join(m['name'] for m in models) if models else 'none'}")


# ── Status ─────────────────────────────────────────────────
@app.get("/status", response_model=ServerStatus)
async def get_status():
    ollama_connected = ollama and await ollama.check_connection()
    models = []
    if ollama_connected:
        for m in await ollama.list_models():
            models.append(ModelInfo(
                name=m["name"], type="llm", size=m.get("size", "?"),
                loaded=True, backend="ollama"
            ))
    return ServerStatus(
        status="running",
        ollama_connected=ollama_connected,
        models_loaded=len(models),
        models_available=models,
        uptime_seconds=time.time() - app.state.start_time if hasattr(app.state, 'start_time') else 0,
    )


# ── Image Analysis ─────────────────────────────────────────
@app.post("/analyze/image", response_model=AnalyzeImageResponse)
async def analyze_image(req: AnalyzeImageRequest):
    """Görsel analiz — image analiz sonuçlarını AI ile yorumla."""
    t0 = time.time()
    model = _validate_model_name(req.model) if req.model else None
    model = model or await _default_vision_model()
    if not model:
        raise HTTPException(503, "No vision model available. Install Ollama and pull a vision model (e.g. llava).")

    if ollama and await ollama.check_connection():
        result = await ollama.generate(
            model=model,
            prompt=req.prompt,
            images=[req.image_base64],
            options={"num_predict": req.max_tokens},
        )
        return AnalyzeImageResponse(
            text=result["text"],
            model_used=model,
            tokens_used=result.get("tokens", 0),
            latency_ms=int((time.time() - t0) * 1000),
        )
    raise HTTPException(503, "AI backend not available")


# ── Anomaly Detection ──────────────────────────────────────
@app.post("/detect/anomaly", response_model=DetectAnomalyResponse)
async def detect_anomaly(req: DetectAnomalyRequest):
    """Manyetik veri noktalarını AI ile analiz et — anomali tespiti."""
    t0 = time.time()
    model = _validate_model_name(req.model) if req.model else None
    model = model or await _default_llm_model()
    if not model:
        raise HTTPException(503, "No LLM model available.")

    # Veriyi prompt'a dönüştür
    data_str = json.dumps(req.data_points[:200], indent=1)  # İlk 200 nokta
    prompt = f"""Manyetik alan verilerini analiz et ve yeraltı yapılarını tespit et.

Veri noktası sayısı: {len(req.data_points)}
{f'Bağlam: {req.context}' if req.context else ''}

Veri (x, y, z koordinatları + manyetik alan bileşenleri):
{data_str}

Lütfen şunları belirle:
1. Anomali bölgeleri (tümsek/alçak)
2. Muhtemel yapı tipleri (oda, tünel, metal, şaft, su)
3. Derinlik tahmini
4. Güven skoru

JSON formatında yanıt ver: {{anomalies: [...], summary: "..."}}
"""
    if ollama and await ollama.check_connection():
        result = await ollama.generate(model=model, prompt=prompt)
        # JSON parse etmeyi dene
        try:
            parsed = json.loads(result["text"])
            detections = parsed.get("anomalies", [])
            summary = parsed.get("summary", result["text"])
        except json.JSONDecodeError:
            detections = []
            summary = result["text"]
        return DetectAnomalyResponse(
            detections=detections,
            summary=summary,
            model_used=model,
            latency_ms=int((time.time() - t0) * 1000),
        )
    raise HTTPException(503, "AI backend not available")


# ── Report Generation ──────────────────────────────────────
@app.post("/generate/report", response_model=GenerateReportResponse)
async def generate_report(req: GenerateReportRequest):
    """Yapısal analiz sonuçlarından profesyonel rapor üret."""
    t0 = time.time()
    model = _validate_model_name(req.model) if req.model else None
    model = model or await _default_llm_model()
    if not model:
        raise HTTPException(503, "No LLM model available.")

    structures_json = json.dumps(req.structures[:50], indent=1, default=str)
    surface_json = json.dumps(req.surface_info, indent=1, default=str)
    lang = "Türkçe" if req.language == "tr" else "English"

    prompt = f"""Aşağıdaki manyetik anomali analiz sonuçlarına dayanarak profesyonel bir jeofizik raporu oluştur.

{lang} dilinde yaz.

Yapısal Analiz Sonuçları:
{structures_json}

Yüzey Bilgisi:
{surface_json}

Rapor şu bölümleri içermeli:
1. Özet (executive summary)
2. Bölge tanımı
3. Tespit edilen yapılar (detaylı)
4. Risk değerlendirmesi
5. Öneriler
"""
    if ollama and await ollama.check_connection():
        result = await ollama.generate(model=model, prompt=prompt, options={"num_predict": 2048})
        return GenerateReportResponse(
            report=result["text"],
            model_used=model,
            latency_ms=int((time.time() - t0) * 1000),
        )
    raise HTTPException(503, "AI backend not available")


# ── Chat (General Purpose) ────────────────────────────────
@app.post("/chat")
async def chat(req: ChatRequest):
    """Genel amaçlı sohbet — VOTEX hakkında sorular, yardım, vb."""
    model = _validate_model_name(req.model) if req.model else None
    model = model or await _default_llm_model()
    if not model:
        raise HTTPException(503, "No LLM model available.")

    system_prompt = """Sen VOTEX AI asistanısın — Manyetik Anomali Analiz Sistemi için yerel yapay zeka.
Jeofizik, manyetik analiz, yeraltı yapıları konularında uzmanlaşmışsın.
Kısa, net ve profesyonel yanıtlar ver. Türkçe öncelikli."""
    full_prompt = f"{system_prompt}\n\nKullanıcı: {req.message}"

    if req.stream and ollama and await ollama.check_connection():
        async def stream_gen():
            async for chunk in ollama.generate_stream(model=model, prompt=full_prompt):
                yield f"data: {json.dumps(chunk)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(stream_gen(), media_type="text/event-stream")

    if ollama and await ollama.check_connection():
        result = await ollama.generate(model=model, prompt=full_prompt)
        return {"text": result["text"], "model": model}
    raise HTTPException(503, "AI backend not available")


# ── WebSocket for live streaming ──────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """VOTEX ile canlı WebSocket bağlantısı — streaming yanıtlar."""
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type", "")
            model = data.get("model")

            if msg_type == "chat":
                model = _validate_model_name(model) if model else None
                model = model or await _default_llm_model()
                if model and ollama and await ollama.check_connection():
                    async for chunk in ollama.generate_stream(
                        model=model, prompt=data.get("message", "")
                    ):
                        await ws.send_json({"type": "chat_chunk", **chunk})
                    await ws.send_json({"type": "chat_done"})
                else:
                    await ws.send_json({"type": "error", "message": "No model available"})

            elif msg_type == "ping":
                await ws.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass


# ── Model Management ──────────────────────────────────────
@app.post("/models/pull")
async def pull_model(name: str = ".*"):
    """Ollama'dan model indir."""
    name = _validate_model_name(name)
    if not name:
        raise HTTPException(400, "Invalid model name")
    if not ollama or not await ollama.check_connection():
        raise HTTPException(503, "Ollama not connected")
    # Background task olarak çalıştır
    asyncio.create_task(_pull_model_bg(name))
    return {"status": "pulling", "model": name}


@app.get("/models/list")
async def list_models():
    """Kullanılabilir modelleri listele."""
    models = []
    if ollama and await ollama.check_connection():
        for m in await ollama.list_models():
            models.append(ModelInfo(
                name=m["name"], type=_classify_model(m["name"]),
                size=m.get("size", "?"), loaded=True, backend="ollama"
            ))
    return models


# ── Helpers ────────────────────────────────────────────────

# Geçersiz model adları — Ollama route'larıyla karışmasın
INVALID_MODEL_NAMES = {"list", "pull", "status", "chat", "models", "generate", "show"}

def _validate_model_name(name: str) -> Optional[str]:
    """Model adını doğrula — geçersiz ise None döndür."""
    if not name or not isinstance(name, str):
        return None
    trimmed = name.strip()
    if len(trimmed) < 2 or trimmed.lower() in INVALID_MODEL_NAMES:
        return None
    return trimmed


async def _default_llm_model() -> Optional[str]:
    if not ollama or not await ollama.check_connection():
        return None
    models = await ollama.list_models()
    # Öncelik: gemma > llama > mistral > qwen > herhangi biri
    priority = ["gemma", "llama", "mistral", "qwen", "phi"]
    for pref in priority:
        for m in models:
            if pref in m["name"].lower():
                return m["name"]
    return models[0]["name"] if models else None


async def _default_vision_model() -> Optional[str]:
    if not ollama or not await ollama.check_connection():
        return None
    models = await ollama.list_models()
    for m in models:
        name = m["name"].lower()
        if any(v in name for v in ["llava", "bakllava", "moondream", "minicpm-v"]):
            return m["name"]
    return None


def _classify_model(name: str) -> str:
    n = name.lower()
    if any(v in n for v in ["llava", "bakllava", "moondream", "minicpm-v", "vision"]):
        return "vision"
    if any(v in n for v in ["embed", "nomic"]):
        return "embedding"
    return "llm"


async def _pull_model_bg(name: str):
    if ollama:
        await ollama.pull_model(name)


app.state.start_time = time.time()


# ── Main ───────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VOTEX AI Server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ollama", default="http://localhost:11434", help="Ollama server URL")
    args = parser.parse_args()
    os.environ["OLLAMA_URL"] = args.ollama
    print(f"[VOTEX AI] Starting on http://{args.host}:{args.port}")
    print(f"[VOTEX AI] Ollama URL: {args.ollama}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
