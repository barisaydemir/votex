from __future__ import annotations

import io
import json
import mimetypes
import time
from pathlib import Path

from google import genai
from google.genai import errors, types
from PIL import Image, ImageStat

from app_config import get_app_config_value
from actions.compass_reader import read_elic_hud
from actions.sensor_validation import (
    set_last_magnetic_analysis,
    should_recommend_thermal,
    sensor_switch_instruction,
    verify_with_thermal as compare_thermal_verification,
)
from actions.windows_utils import capture_window

VISION_MODELS = (
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
)
VISION_MAX_DIMENSION = 1920
VISION_MAX_INLINE_BYTES = 5_500_000
VISION_LOG = Path(__file__).resolve().parent.parent / "logs" / "vision.log"


def _log_vision(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}"
    print(f"[vision] {msg}", flush=True)
    try:
        VISION_LOG.parent.mkdir(parents=True, exist_ok=True)
        with VISION_LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _screen_permission_message() -> str:
    return (
        "Ekran goruntusu alinamadi. ELIC programinin acik ve gorunur oldugundan, "
        "Windows oturumunun kilitli olmadigindan emin ol."
    )


def _image_looks_blank(image_path: Path) -> bool:
    try:
        with Image.open(image_path) as img:
            sample = img.convert("RGB")
            stat = ImageStat.Stat(sample)
            means = stat.mean
            extrema = stat.extrema
            max_seen = max(channel[1] for channel in extrema)
            mean_total = sum(means) / max(1, len(means))
            return max_seen <= 8 or mean_total <= 3
    except Exception:
        return False


def _build_image_part(image_path: Path) -> types.Part:
    mime_type, _ = mimetypes.guess_type(str(image_path))
    if not mime_type:
        mime_type = "image/png"

    try:
        with Image.open(image_path) as img:
            work = img.copy()
        if work.mode not in {"RGB", "L"}:
            work = work.convert("RGB")
        if max(work.size) > VISION_MAX_DIMENSION:
            work.thumbnail((VISION_MAX_DIMENSION, VISION_MAX_DIMENSION), Image.Resampling.LANCZOS)

        png_buffer = io.BytesIO()
        work.save(png_buffer, format="PNG", optimize=True)
        png_bytes = png_buffer.getvalue()
        if len(png_bytes) <= VISION_MAX_INLINE_BYTES:
            return types.Part.from_bytes(data=png_bytes, mime_type="image/png")

        jpg_buffer = io.BytesIO()
        work.convert("RGB").save(jpg_buffer, format="JPEG", quality=88, optimize=True)
        return types.Part.from_bytes(data=jpg_buffer.getvalue(), mime_type="image/jpeg")
    except Exception:
        return types.Part.from_bytes(data=image_path.read_bytes(), mime_type=mime_type)


def _build_elic_prompt(query: str, structured: dict, window_title: str) -> str:
    user_query = (query or "ELIC ekranini yorumla").strip()
    stats_json = json.dumps(structured, ensure_ascii=False, indent=2)

    return (
        "Sen Derin Tarama Asistan (DTA) — Proton ELIC saha yorum asistanisin.\n"
        f"Pencere: {window_title or 'ELIC'}\n\n"
        "DONANIM: LiDAR (yesil yuzey), Manyetik (yer manyetik alanindan suzulerek renk), "
        "Termal (dogrulama), Lazer (orta daire).\n"
        "HUD: Orta daire + yaninda Depth = bakilan derinlik; ust cizgi = yon; "
        "yan dikey gosterge = anomalik deger.\n"
        "RENK IPUCU: Yesil=zemin; Mavi=bosluk/su; Kirmizi=metal; "
        "Mavi VEYA kirmizi cevresinde ince beyaz isik cizgileri=duvar; "
        "Yesilden ince beyaz isik=oda/tunel ipucu. Ince cizgiler kesin degil, ipucu.\n"
        "ÇAPRAZ: metal+mavi → bosluk ici metal; mavi/kirmizi+beyaz kenar → duvar; "
        "glow → oda/tunel.\n\n"
        "Asagidaki JSON on-analiz + inference hipotezleridir. Ekranla capraz dogrula; "
        "celiskide ekrani esas al, sayilari kullan.\n"
        "Depth, ust yon, yan anomali gostergesini harfiyen oku.\n\n"
        f"ON-ANALIZ JSON:\n{stats_json}\n\n"
        f"Kullanici sorusu: {user_query}\n\n"
        "Turkce, saha dilinde, kisa yanit ver. "
        "Ana hipotez, konum, derinlik ve sonraki adimi (termal vb.) soyle."
    )


def _extract_response_text(response) -> str:
    text = str(getattr(response, "text", "") or "").strip()
    if text:
        return text
    candidates = getattr(response, "candidates", None) or []
    chunks: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            part_text = str(getattr(part, "text", "") or "").strip()
            if part_text:
                chunks.append(part_text)
    return "\n".join(chunks).strip()


def _is_transient_vision_error(exc: Exception) -> bool:
    if isinstance(exc, (errors.ServerError, TimeoutError)):
        return True
    message = str(exc or "").lower()
    return any(marker in message for marker in (
        "503", "429", "deadline", "timed out", "timeout", "unavailable",
        "temporarily unavailable", "service unavailable", "internal error",
        "busy", "overloaded", "resource exhausted", "try again later",
    ))


def _is_model_missing_error(exc: Exception) -> bool:
    message = str(exc or "").lower()
    return any(marker in message for marker in (
        "404", "not found", "not supported", "unknown model", "is not found",
        "no longer available", "deprecated",
    ))


def _friendly_vision_error(exc: Exception) -> str:
    message = str(exc or "").lower()
    if any(marker in message for marker in ("429", "quota", "rate limit", "too many requests", "billing", "resource_exhausted")):
        return (
            "Gemini API kotasi doldu veya ucretsiz kota bu model icin kapali. "
            "ai.google.dev uzerinden faturalandirma / kota kontrol edin; bir dakika sonra tekrar deneyin."
        )
    if any(marker in message for marker in ("404", "no longer available", "not found", "not supported for")):
        return (
            "Secilen Gemini vision modeli bu anahtar icin kullanilamiyor. "
            "DTA model listesi guncellendi; uygulamayi yeniden baslatin."
        )
    if any(marker in message for marker in ("api key", "401", "403", "permission", "invalid_argument")):
        return "Gemini API anahtari gecersiz veya vision izni yok. config/api_keys.json kontrol edin."
    if _is_transient_vision_error(exc):
        return "Gemini vision servisi su anda yogun veya gecici olarak ulasilamiyor."
    return f"Gemini vision istegi basarisiz oldu: {exc}"


def _local_screen_summary(structured: dict, query: str) -> str:
    """Gemini yoksa yerel heatmap/HUD yorumu — sahada bos kalmasin."""
    lines: list[str] = ["Yerel ekran yorumu (Gemini vision yerine):"]
    sensor = structured.get("active_sensor") or "?"
    depth = structured.get("depth_m")
    heading = structured.get("heading_cardinal") or structured.get("heading_deg")
    gauge = structured.get("anomaly_gauge")
    stats = structured.get("heatmap_stats") or {}
    lines.append(f"- Sensor: {sensor}")
    if depth is not None:
        lines.append(f"- Depth: {depth} m")
    if heading is not None:
        lines.append(f"- Yon: {heading}")
    if gauge is not None:
        lines.append(f"- Anomali gostergesi: {gauge}")
    if stats:
        lines.append(
            "- Harita: "
            f"metal %{stats.get('metal_pct', '?')}, "
            f"bosluk %{stats.get('void_pct', '?')}, "
            f"zemin %{stats.get('soil_pct', '?')}"
        )
    local = ((structured.get("inference") or {}).get("summary") or "").strip()
    if local:
        lines.append(f"- Cikarim: {local}")
    actions = (structured.get("inference") or {}).get("recommended_actions") or []
    if actions:
        lines.append("- Sonraki adim: " + "; ".join(str(a) for a in actions[:3]))
    q = (query or "").strip()
    if q:
        lines.append(f"(Soru: {q})")
    return "\n".join(lines)


def _analyze_with_gemini(query: str, image_path: Path, structured: dict, window_title: str) -> str:
    api_key = str(get_app_config_value("gemini_api_key", "") or "").strip()
    if not api_key:
        return _local_screen_summary(structured, query) + "\n\nGemini API anahtari eksik."

    prompt = _build_elic_prompt(query, structured, window_title)
    client = genai.Client(api_key=api_key)
    image_part = _build_image_part(image_path)
    last_error: Exception | None = None

    for model_name in VISION_MODELS:
        for attempt, delay in enumerate((0.6, 1.2), start=1):
            try:
                _log_vision(f"deneme model={model_name} attempt={attempt}")
                response = client.models.generate_content(
                    model=model_name,
                    contents=[prompt, image_part],
                    config=types.GenerateContentConfig(temperature=0.2),
                )
                merged = _extract_response_text(response)
                if merged:
                    _log_vision(f"ok model={model_name} chars={len(merged)}")
                    return merged
                raise RuntimeError("Gemini gecerli bir ELIC analizi metni dondurmedi.")
            except Exception as exc:
                last_error = exc
                _log_vision(f"hata model={model_name}: {exc}")
                if _is_model_missing_error(exc):
                    break
                if attempt < 2 and _is_transient_vision_error(exc):
                    time.sleep(delay)
                    continue
                break

    assert last_error is not None
    raise RuntimeError(_friendly_vision_error(last_error))


def analyze_elic_screen(query: str = "ELIC ekranini yorumla") -> str:
    target = str(get_app_config_value("elic_window_title", "ELIC") or "ELIC").strip()
    depth_cap = float(get_app_config_value("elic_depth_cap_m", 10) or 10)

    ok, detail, payload = capture_window(target)
    if not ok:
        if target.lower() != "active_window":
            return (
                f"ELIC programi bulunamadi (aranan pencere: '{target}'). "
                f"{detail} ELIC acik mi? config/api_keys.json icinde elic_window_title degerini kontrol et."
            )
        return f"Ekran goruntusu alinamadi: {detail}. {_screen_permission_message()}"

    image_path = Path(str(payload.get("image_path", "")))
    window_title = str(payload.get("window_title", "") or target).strip()

    try:
        if not image_path.exists() or image_path.stat().st_size <= 0:
            return "Ekran goruntusu dosyasi bos geldi. " + _screen_permission_message()
        if _image_looks_blank(image_path):
            return "Ekran goruntusu siyah veya bos gorunuyor. " + _screen_permission_message()

        structured = read_elic_hud(image_path, depth_cap_m=depth_cap, use_gemini=True)

        if structured.get("active_sensor") == "magnetic":
            set_last_magnetic_analysis(structured)

        try:
            analysis = _analyze_with_gemini(query, image_path, structured, window_title)
        except Exception as exc:
            prefix = window_title or target
            local = _local_screen_summary(structured, query)
            _log_vision(f"fallback local: {exc}")
            return (
                f"[ELIC: {prefix}]\n{local}\n\n"
                f"(Gemini vision yanit vermedi — yerel yorum kullanildi. Detay: {exc})"
            )

        if structured.get("active_sensor") == "magnetic" and should_recommend_thermal(structured):
            analysis = f"{analysis}\n\n{sensor_switch_instruction('thermal')}"

        local_summary = ((structured.get("inference") or {}).get("summary") or "").strip()
        if local_summary and local_summary not in analysis:
            analysis = f"{analysis}\n\n[Yerel cikarim] {local_summary}"

        title = window_title or target
        return f"[ELIC: {title}]\n{analysis}"
    finally:
        try:
            if image_path.exists():
                image_path.unlink()
        except Exception:
            pass


def verify_elic_thermal() -> str:
    """Termal ekrani yakala ve onceki manyetik bulguyla karsilastir."""
    target = str(get_app_config_value("elic_window_title", "ELIC") or "ELIC").strip()
    depth_cap = float(get_app_config_value("elic_depth_cap_m", 10) or 10)

    ok, detail, payload = capture_window(target)
    if not ok:
        return f"ELIC ekrani alinamadi: {detail}"

    image_path = Path(str(payload.get("image_path", "")))
    try:
        structured = read_elic_hud(image_path, depth_cap_m=depth_cap, use_gemini=True)
        return compare_thermal_verification(structured)
    finally:
        try:
            if image_path.exists():
                image_path.unlink()
        except Exception:
            pass
