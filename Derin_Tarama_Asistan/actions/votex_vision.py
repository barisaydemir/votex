"""
VOTEX ofis ekranı — DTA vision yorumu.

Proton ELIC sahada; VOTEX aynı colormap'i 3D yapıya çevirir.
analyze_votex_screen: VOTEX penceresini yakalar, ekran kılavuzu + Gemini ile yorumlar.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from google import genai
from google.genai import types

from app_config import get_app_config_value
from actions.windows_utils import capture_window
from actions.elic_vision import (
    VISION_MODELS,
    _build_image_part,
    _extract_response_text,
    _friendly_vision_error,
    _image_looks_blank,
    _is_model_missing_error,
    _is_transient_vision_error,
    _local_screen_summary,
    _log_vision,
    _screen_permission_message,
)

BASE_DIR = Path(__file__).resolve().parent.parent
GUIDE_PATH = BASE_DIR / "schema" / "VOTEX_EKRAN.md"

# Runtime yedek (md yoksa)
VOTEX_SCREEN_GUIDE = """
VOTEX = ofis 3D komuta merkezi (Tactical Geophysics Command Center).
Proton ELIC manyetik colormap → doğrulanmış yeraltı yapıları.

EKRAN:
- Sol OPS: dosya, dik/yan çekim, hedef tipi, telemetri, 2D önizleme
- Orta STAGE: 3D — yeşil zemin colormap + oda/tünel/metal mesh + numara pinleri
- Sağ INTEL: kabul/red, oda, şaft, tünel, metal sayıları + yapı listesi

ÇEKİM:
- Dik: plan; derinlik sinyalden (~10 m)
- Yan: kesit; görüntü üstü yüzey, altı derinlik (~3 m); X hat mesafesi

RENK (ELIC ile aynı):
- Yeşil=zemin; Mavi=boşluk/oda; Kırmızı=metal (boşluk içinde de olabilir)
- İnce beyaz=duvar/yapı ipucu (kesin değil)

3D OKUMA:
- Oda kutuları mavi lekelerin üstünde; yan çekimde ince kesit
- Kemerli form=tünel; kırmızı blok=manyetik alan; "tünel içi"=koridor içi anomali
- Pin = yapı numarası


LEGACY3DMAG DIK CEKIM (JSON) MODU:
- Her ADIM bir karedir (satir x sutun grid, or. 6x3); numara varsayilan SAGDAN SOLA (RTL)
- Adim secilince yalniz o kare + o adimin objeleri gorunur; TEMIZLE tum sahayi getirir
- DERINLIK etikette METRE olarak yazar (ust-alt aralik); 1 m referans kazigi kalibrasyonu varsa degerler kalibre proxy
- GUVEN yuzde + durum: GUCULU/DIKKAT/NORMAL; GUCULU -> dogrulama taramasi oner
- KESIKLI MAVI INCE CIZGI = lateral yanit adayi: ayni kaynaktan gelme OLASILIGI;
  fiziksel baglanti/birlesme karari DEGIL, footprint boyutunu buyutmez. 'Kesin birlesti' DEME.
- Kirmizi footprint yalniz kendi olculen boyutunda; buyuk bosluklar bos kalir
- Birlesik hedef = birkac kanittan birlesen hedef adayi (kartta kanit sayisi + yatay baglanti)

YORUM: çekim tipini söyle; mavi oda vs kırmızı metal ilişkisini kur;
INTEL sayılarıyla çaprazla; ipucu kesin tespit değildir; kısa Türkçe saha dili.
"""


def _load_guide() -> str:
    try:
        if GUIDE_PATH.is_file():
            text = GUIDE_PATH.read_text(encoding="utf-8").strip()
            if len(text) > 80:
                return text
    except Exception:
        pass
    return VOTEX_SCREEN_GUIDE.strip()


def _build_votex_prompt(user_query: str, window_title: str, structured: dict | None = None) -> str:
    guide = _load_guide()
    stats_json = "{}"
    if structured:
        try:
            stats_json = json.dumps(structured, ensure_ascii=False, indent=2)[:6000]
        except Exception:
            stats_json = str(structured)[:2000]
    return (
        "Sen Derin Tarama Asistan (DTA) icin VOTEX ofis ekrani yorumcususun.\n"
        "Bu ekran Proton ELIC degil — VOTEX 3D dogrulama arayuzu.\n\n"
        f"Pencere basligi: {window_title or 'VOTEX'}\n\n"
        "EKRAN KILAVUZU:\n"
        f"{guide}\n\n"
        "Asagidaki JSON, ayni ELIC heatmap/HUD algoritmalarinin VOTEX yakalamasi "
        "uzerinde calismasiyla uretildi (2D onizleme / colormap). "
        "Ekrandaki 3D yapilar ve INTEL sayilariyla capraz dogrula; celiskide "
        "colormap + 3D mesh esas.\n\n"
        f"YEREL ALGORITMA JSON:\n{stats_json}\n\n"
        f"Kullanici sorusu: {user_query}\n\n"
        "Goruntudeki panelleri, cekim tipini (dik/yan), colormap renklerini ve "
        "3D yapilari (oda/tunel/metal/pin) oku. INTEL sayilarini kullan.\n"
        "Turkce, kisa saha dili. Ana hipotez + ne goruyorsun + risk/ipucu. "
        "Ince cizgi kesin tespit degil. Uydurma."
    )


def _analyze_votex_with_gemini(
    query: str,
    image_path: Path,
    window_title: str,
    structured: dict | None = None,
) -> str:
    api_key = str(get_app_config_value("gemini_api_key", "") or "").strip()
    if not api_key:
        local = _local_screen_summary(structured or {}, query) if structured else ""
        return (
            "VOTEX ekrani yakalandi ama Gemini API anahtari eksik. "
            + (local or "Kilavuz: sol OPS / orta 3D / sag INTEL.")
        )

    prompt = _build_votex_prompt(query, window_title, structured)
    client = genai.Client(api_key=api_key)
    image_part = _build_image_part(image_path)
    last_error: Exception | None = None

    for model_name in VISION_MODELS:
        for attempt, delay in enumerate((0.6, 1.2), start=1):
            try:
                _log_vision(f"votex model={model_name} attempt={attempt}")
                response = client.models.generate_content(
                    model=model_name,
                    contents=[prompt, image_part],
                    config=types.GenerateContentConfig(temperature=0.2),
                )
                merged = _extract_response_text(response)
                if merged:
                    _log_vision(f"votex ok model={model_name} chars={len(merged)}")
                    return merged
                raise RuntimeError("Gemini gecerli bir VOTEX analizi metni dondurmedi.")
            except Exception as exc:
                last_error = exc
                _log_vision(f"votex hata model={model_name}: {exc}")
                if _is_model_missing_error(exc):
                    break
                if attempt < 2 and _is_transient_vision_error(exc):
                    time.sleep(delay)
                    continue
                break

    assert last_error is not None
    raise RuntimeError(_friendly_vision_error(last_error))


def analyze_votex_screen(query: str = "VOTEX ekranini yorumla") -> str:
    """VOTEX penceresini yakala; yerel ELIC algoritmalari + 3D kilavuz ile yorumla."""
    target = str(get_app_config_value("votex_window_title", "Votex") or "Votex").strip()
    candidates = [target]
    for alt in ("VOTEX", "Tactical Command", "Manyetik Anomali", "votex"):
        if alt.lower() not in {c.lower() for c in candidates}:
            candidates.append(alt)

    image_path: Path | None = None
    window_title = ""
    last_detail = ""
    depth_cap = float(get_app_config_value("elic_depth_cap_m", 10) or 10)

    try:
        for cand in candidates:
            ok, detail, payload = capture_window(cand)
            if ok:
                image_path = Path(str(payload.get("image_path", "")))
                window_title = str(payload.get("window_title", "") or cand).strip()
                break
            last_detail = detail

        if image_path is None:
            return (
                f"VOTEX penceresi bulunamadi (aranan: {', '.join(candidates)}). "
                f"{last_detail} VOTEX acik mi? config/api_keys.json icinde "
                f"votex_window_title degerini kontrol et (ornek: 'Votex')."
            )

        if not image_path.exists() or image_path.stat().st_size <= 0:
            return "VOTEX ekran goruntusu bos geldi. " + _screen_permission_message()
        if _image_looks_blank(image_path):
            return "VOTEX ekran goruntusu siyah veya bos. " + _screen_permission_message()

        # Mevcut ELIC heatmap / HUD / inference motoru — VOTEX yakalamasi uzerinde
        structured: dict = {}
        try:
            from actions.compass_reader import read_elic_hud

            structured = read_elic_hud(
                image_path, depth_cap_m=depth_cap, use_gemini=False
            ) or {}
            _log_vision(
                f"votex local_algo stats={bool(structured.get('heatmap_stats'))} "
                f"hyp={bool((structured.get('inference') or {}).get('hypotheses'))}"
            )
        except Exception as exc:
            _log_vision(f"votex local_algo skip: {exc}")
            structured = {}

        try:
            analysis = _analyze_votex_with_gemini(
                query, image_path, window_title, structured
            )
        except Exception as exc:
            _log_vision(f"votex fallback: {exc}")
            local = _local_screen_summary(structured, query) if structured else ""
            return (
                f"[VOTEX: {window_title or target}]\n"
                + (local or "Ekran yakalandi; Gemini yorumu alinamadi.")
                + f"\n(Detay: {exc})"
            )

        local_summary = ((structured.get("inference") or {}).get("summary") or "").strip()
        if local_summary and local_summary not in analysis:
            analysis = f"{analysis}\n\n[Yerel algoritma] {local_summary}"

        return f"[VOTEX: {window_title or target}]\n{analysis}"
    finally:
        try:
            if image_path is not None and image_path.exists():
                image_path.unlink()
        except Exception:
            pass
