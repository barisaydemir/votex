#!/usr/bin/env python3
"""
Derin Tarama Asistan (DTA) — Proton ELIC uyumlu sesli saha yardımcısı
Windows tablette ELIC programı yanında çalışır.

Üretici: Barış Aydemir — Digital Future Tech
Bu yazılım Barış Aydemir / Digital Future Tech üretimidir.
"""

from __future__ import annotations

import asyncio
import datetime
import threading
import traceback
import os
import re
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    # Tk / ImageGrab'dan ONCE — yoksa 1920x1200 → ~1280x800 kirpik kalir
    try:
        import ctypes

        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# AGIR import'lar (google/pyaudio/elic) mainloop'tan SONRA — aksi halde
# ElitePad'de pencere açılmadan kum saati saatlerce döner.
from app_config import get_app_config_value, get_product_name, PRODUCT_NAME
from actions import votex_chat
from ui import JarvisUI

BASE_DIR = Path(__file__).resolve().parent
PROMPT_PATH = BASE_DIR / "core" / "prompt.txt"
BOOT_LOG = BASE_DIR / "logs" / "boot.log"

CONTROL_TOKEN_RE = re.compile(r"<ctrl\d+>", re.IGNORECASE)
# 3.1-flash-live bazi anahtarlarda baglanip sonsuz susuyor; 2.5 native audio yanit veriyor.
LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
LIVE_MODELS = (
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-3.1-flash-live-preview",
)
# Windows/tablette PortAudio bazen PyAudio() içinde sonsuz asılı kalır;
# event loop kilitlenmesin diye ayrı thread + süre sınırı.
PYAUDIO_INIT_TIMEOUT_S = 8.0
_pyaudio_lock = threading.Lock()

# Lazy runtime (runner thread doldurur)
pyaudio = None  # type: ignore
genai = None  # type: ignore
types = None  # type: ignore
load_memory = update_memory = delete_memory = format_memory_for_prompt = None  # type: ignore
sys_info = None  # type: ignore
analyze_elic_screen = verify_elic_thermal = None  # type: ignore
analyze_votex_screen = None  # type: ignore
analyze_workspace_screens = None  # type: ignore
guide_votex = None  # type: ignore
recommend_sensor_switch = None  # type: ignore
get_navigation_guidance = get_survey_status = mark_survey_corner = start_survey = None  # type: ignore
check_tool_allowed = record_tool_usage = None  # type: ignore

FORMAT = None
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECV_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024
pya = None  # tablette import'ta PyAudio() asili kalmasin


def _boot_log(msg: str) -> None:
    line = f"{datetime.datetime.now().isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    try:
        BOOT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BOOT_LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _load_heavy_runtime() -> None:
    """Pencere acildiktan sonra agir kutuphaneleri yukle."""
    global pyaudio, genai, types
    global load_memory, update_memory, delete_memory, format_memory_for_prompt
    global sys_info, analyze_elic_screen, verify_elic_thermal, analyze_votex_screen
    global analyze_workspace_screens, guide_votex
    global recommend_sensor_switch
    global get_navigation_guidance, get_survey_status, mark_survey_corner, start_survey
    global check_tool_allowed, record_tool_usage, FORMAT

    t0 = time.time()
    _boot_log("[boot] pyaudio...")
    import pyaudio as _pyaudio  # type: ignore[reportMissingModuleSource]
    pyaudio = _pyaudio
    FORMAT = pyaudio.paInt16

    _boot_log("[boot] google.genai...")
    from google import genai as _genai  # type: ignore[reportMissingImports]
    from google.genai import types as _types  # type: ignore[reportMissingImports]
    genai = _genai
    types = _types

    _boot_log("[boot] memory + actions...")
    from memory.memory_manager import (
        load_memory as _lm,
        update_memory as _um,
        delete_memory as _dm,
        format_memory_for_prompt as _fm,
    )
    load_memory, update_memory, delete_memory, format_memory_for_prompt = _lm, _um, _dm, _fm

    from actions.sys_info import sys_info as _si
    sys_info = _si

    from actions.elic_vision import analyze_elic_screen as _aes, verify_elic_thermal as _vet
    analyze_elic_screen, verify_elic_thermal = _aes, _vet
    from actions.votex_vision import analyze_votex_screen as _avs
    analyze_votex_screen = _avs
    from actions.screen_workspace import analyze_workspace_screens as _aws
    analyze_workspace_screens = _aws
    from actions.votex_guide import guide_votex as _gv
    guide_votex = _gv
    try:
        from actions.votex_guide import start_votex_heartbeat

        start_votex_heartbeat()
    except Exception:
        pass

    from actions.sensor_validation import recommend_sensor_switch as _rss
    recommend_sensor_switch = _rss

    from actions.survey_nav import (
        get_navigation_guidance as _gng,
        get_survey_status as _gss,
        mark_survey_corner as _msc,
        start_survey as _ss,
    )
    get_navigation_guidance, get_survey_status, mark_survey_corner, start_survey = _gng, _gss, _msc, _ss

    from core.license_manager import check_tool_allowed as _cta, record_tool_usage as _rtu
    check_tool_allowed, record_tool_usage = _cta, _rtu

    _boot_log(f"[boot] runtime hazir ({time.time() - t0:.1f}s)")


def _get_pyaudio(timeout_s: float = PYAUDIO_INIT_TIMEOUT_S):
    """PyAudio örneği — asla çağıran async loop'u kilitlememeli.

    PortAudio bazı sürücülerde `PyAudio()` içinde asılı kalır; süre dolunca
    TimeoutError yükselir (arka thread daemon olarak kalabilir).
    Mikrofon + hoparlör aynı anda çağırabilir → tek init için kilit.
    """
    global pya
    if pyaudio is None:
        raise RuntimeError("pyaudio henuz yuklenmedi")
    if pya is not None:
        return pya

    with _pyaudio_lock:
        if pya is not None:
            return pya

        box: dict = {"pa": None, "err": None}

        def _build():
            try:
                _boot_log("[boot] PyAudio() olusturuluyor...")
                box["pa"] = pyaudio.PyAudio()
                _boot_log("[boot] PyAudio hazir")
            except Exception as e:
                box["err"] = e

        t = threading.Thread(target=_build, daemon=True, name="dta-pyaudio-init")
        t.start()
        t.join(timeout=max(1.0, float(timeout_s)))
        if t.is_alive():
            _boot_log(f"[boot] PyAudio zaman asimi ({timeout_s:.0f}s) — yazi-modu")
            raise TimeoutError(
                f"PyAudio {timeout_s:.0f}s icinde acilmadi (ses surucusu asili)"
            )
        if box["err"] is not None:
            _boot_log(f"[boot] PyAudio hata: {box['err']}")
            raise box["err"]
        if box["pa"] is None:
            raise RuntimeError("PyAudio olusturulamadi")
        pya = box["pa"]
        return pya

LICENSE_GATED_TOOLS = frozenset({
    "analyze_elic_screen",
    "analyze_screen",
    "analyze_votex_screen",
    "analyze_workspace_screens",
    "guide_votex",
    "export_elic_case",
    "start_survey",
    "mark_survey_corner",
    "get_navigation_guidance",
    "get_survey_status",
    "recommend_sensor_switch",
    "verify_with_thermal",
})


TOOL_DECLARATIONS = [
    {
        "name": "analyze_elic_screen",
        "description": (
            "Acik saha/ofis ekranlarini inceler: Proton ELIC ve/veya VOTEX. "
            "Iki monitör kullanildiginda ikisini de yakalar. "
            "VOTEX penceresi gorunurse mevcut heatmap/HUD/inference algoritmalariyla "
            "ve 3D INTEL paneliyle degerlendirir. "
            "Kullanici 'ekrani yorumla', 'ne goruyorsun', 'iki ekrana bak' dediginde kullan."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": (
                        "Kullanici sorusu. Ornek: 'Ekranlari yorumla', "
                        "'ELIC ile VOTEX uyumlu mu?', 'Metal mi bosluk mu?'"
                    )
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "analyze_votex_screen",
        "description": (
            "Once VOTEX penceresini arar; aciksa degerlendirir. "
            "ELIC de aciksa her iki ekrani birlikte yorumlar (cift monitör). "
            "'VOTEX ekranini yorumla', '3D sahneye bak' icin kullan."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": (
                        "VOTEX / cift ekran sorusu. "
                        "Ornek: 'VOTEX ekranini yorumla', 'Odalar dogru mu?'"
                    )
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "guide_votex",
        "description": (
            "VOTEX 3D sahnesine dogrudan mudahale: eksik oda/tunel/metal icin "
            "normalize (0-1) konum ipucu gonderir; VOTEX 3D'yi yeniden cizer ve kaydeder. "
            "Bu localhost koprusudur (internet degil) — basarisizlikta 'baglantim kotu' deme, "
            "VOTEX acik mi / 3D var mi soyle. "
            "Kullanici 'burada oda olabilir', 'eksik odayi ciz', 'VOTEX'e yonlendir' "
            "dediginde kullan. Once VOTEX'te en az bir 3D analiz yapilmis olmali."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "hints": {
                    "type": "ARRAY",
                    "description": (
                        "Yapi ipuclari. Her oge: kind (room|tomb|tunnel|metal|shaft), "
                        "cx, cy (0-1 harita), istege bagli rx, ry, label."
                    ),
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "kind": {"type": "STRING"},
                            "cx": {"type": "NUMBER"},
                            "cy": {"type": "NUMBER"},
                            "rx": {"type": "NUMBER"},
                            "ry": {"type": "NUMBER"},
                            "label": {"type": "STRING"},
                        },
                    },
                },
                "clear": {
                    "type": "BOOLEAN",
                    "description": "True ise onceki DTA ipuclarini sil",
                },
                "append": {
                    "type": "BOOLEAN",
                    "description": "True ise mevcut ipuclara ekle (varsayilan degistir)",
                },
                "rebuild": {
                    "type": "BOOLEAN",
                    "description": "True (varsayilan): 3D'yi yeniden hesapla",
                },
                "note": {
                    "type": "STRING",
                    "description": "Kisa operator notu",
                },
            },
        }
    },
    {
        "name": "export_elic_case",
        "description": (
            "Proton ELIC ekranini yakalayip Votex uyumlu ELIC Case ZIP raporu uretir "
            "(manifest, analysis, inference, screen.png). "
            "Kullanici 'rapor al', 'case kaydet', 'votex icin kaydet' dediginde kullan."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "note": {
                    "type": "STRING",
                    "description": "Istege bagli operator notu",
                }
            },
        }
    },
    {
        "name": "sys_info",
        "description": "Sistem bilgisi alir: pil durumu, CPU, RAM, disk, saat, tarih, ag baglantisi.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "battery | cpu | ram | disk | time | date | network | all"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "save_memory",
        "description": "Kullanici hakkinda onemli bilgiyi kalici bellege kaydeder.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {
                    "type": "STRING",
                    "description": "identity | preferences | projects | notes"
                },
                "key": {"type": "STRING", "description": "Kisa anahtar"},
                "value": {"type": "STRING", "description": "Deger"}
            },
            "required": ["category", "key", "value"]
        }
    },
    {
        "name": "delete_memory",
        "description": "Kalici hafizadaki bir kaydi siler.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {"type": "STRING", "description": "Kategori"},
                "key": {"type": "STRING", "description": "Anahtar"},
                "match_text": {"type": "STRING", "description": "Kaydi bulmak icin metin parcasi"}
            }
        }
    },
    {
        "name": "start_survey",
        "description": (
            "Dikdortgen saha taramasini baslatir. Operator alan boyutunu bir kez soyler "
            "(ornegin 10x15 metre). Sonra koseleri sirayla isaretler."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "width_m": {"type": "NUMBER", "description": "Saha genisligi metre"},
                "length_m": {"type": "NUMBER", "description": "Saha uzunlugu metre"},
            },
            "required": ["width_m", "length_m"],
        },
    },
    {
        "name": "mark_survey_corner",
        "description": (
            "Aktif taramada bir koseyi isaretler. ELIC ekranindan pusula, manyetik derinlik "
            "ve LiDAR zemin referansi okunur. Koseler 1, 2, 3 sirasiyla isaretlenmeli."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "corner_index": {
                    "type": "INTEGER",
                    "description": "Kose numarasi: 1, 2, 3 veya 4",
                }
            },
            "required": ["corner_index"],
        },
    },
    {
        "name": "get_navigation_guidance",
        "description": (
            "3 kose isaretlendikten sonra 4. koseye sesli yonlendirme verir. "
            "Anlik pusula okur, hedef yon ve kalan mesafeyi soyler."
        ),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "get_survey_status",
        "description": "Aktif tarama durumu: kac kose isaretli, tahmini 4. kose konumu.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "recommend_sensor_switch",
        "description": (
            "Manyetik bulguya gore termal veya manyetik sensore gecis onerir. "
            "Bosluk veya belirsiz sinyalde termal dogrulama oner."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "target": {
                    "type": "STRING",
                    "description": "thermal veya magnetic",
                }
            },
        },
    },
    {
        "name": "verify_with_thermal",
        "description": (
            "Termal modda ELIC ekranini alir ve onceki manyetik bulguyla capraz dogrular."
        ),
        "parameters": {"type": "OBJECT", "properties": {}},
    },
]


def get_api_key() -> str:
    return str(get_app_config_value("gemini_api_key", "") or "")


def load_system_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "Sen Derin Tarama Asistan'sin — Proton ELIC saha operatoru icin sesli jeofizik yorum asistani. "
            "Turkce konus. Ekran sorularinda analyze_elic_screen kullan — "
            "acik ELIC ve VOTEX pencerelerinin ikisini de tarar."
        )


class JarvisLive:
    def __init__(self, ui: JarvisUI):
        self.ui = ui
        self.session = None
        self.audio_in_queue = None
        self.out_queue = None
        self._loop = None
        self._is_speaking = False
        self._speaking_lock = threading.Lock()
        self._paused = False

        self.ui.on_text_command = self._on_text_command
        self.ui.on_pause_toggle = self._on_pause_toggle
        self.ui.on_effects_state_change = self._on_effects_state_change
        self.ui.on_window_hide_request = self._on_votex_window_hide
        self.ui.on_window_restore_request = self._on_votex_window_restore

    def _on_pause_toggle(self, paused: bool):
        self._paused = paused

    def _on_effects_state_change(self, enabled: bool):
        pass

    def _focus_ui_section_for_tool(self, tool_name: str, args: dict):
        if tool_name == "sys_info":
            query = str(args.get("query", "")).strip().lower()
            if query in {"time", "saat", "zaman", "date", "tarih"}:
                self.ui.focus_panel("time", duration_ms=5200)
            else:
                self.ui.focus_panel("system", duration_ms=5200)

    def _on_text_command(self, text: str):
        if self._paused:
            return
        self.ui.write_log(f"Siz: {text}")
        # Yazılan komut da VOTEX panelinde görünsün (yanıt turuyla gelir)
        self._push_votex_chat(text, "", source="text")
        if not self._loop or not self.session:
            self.ui.write_log(f"ERR: {get_product_name()} baglantisi henuz hazir degil.")
            return
        asyncio.run_coroutine_threadsafe(self._send_user_text(text), self._loop)

    # ── VOTEX panel sohbet köprüsü (localhost 18765) ────────────────────────
    def _push_votex_chat(self, user_text: str, assistant_text: str, *, source: str = "voice") -> None:
        """Konuşma turunu VOTEX DTA paneline iter; asla asistan akışını bloklamaz."""
        now_ms = int(time.time() * 1000)
        turns = []
        if user_text:
            turns.append({"role": "user", "text": user_text, "ts": now_ms, "meta": source})
        if assistant_text:
            turns.append({"role": "assistant", "text": assistant_text, "ts": now_ms})
        if not turns:
            return

        def _send():
            try:
                votex_chat.push_chat_turns(turns)
            except Exception:
                pass

        threading.Thread(target=_send, name="votex-chat-push", daemon=True).start()

    def _on_votex_panel_message(self, text: str) -> bool:
        """VOTEX panelinden gelen mesaj; işlendiyse True (poller ack'ler)."""
        if self._paused:
            return False  # duraklatıldı — poller yeniden deneyecek
        try:
            self.ui.write_log(f"SYS: VOTEX panel: {text[:160]}")
        except Exception:
            pass
        if not self._loop or not self.session:
            self.ui.write_log(f"ERR: {get_product_name()} baglantisi henuz hazir degil.")
            return False  # bağlantı gelene kadar kuyrukta beklet
        asyncio.run_coroutine_threadsafe(self._send_user_text(text), self._loop)
        return True

    # ── VOTEX panel: pencere gizle/geri getir istekleri ──────────────────
    def _on_votex_window_hide(self) -> bool:
        """DTA penceresini tray'e küçültür; konuşma aynen sürer."""
        try:
            self.ui.write_log("SYS: Pencere VOTEX panelinden gizlendi (konuşma sürüyor)")
        except Exception:
            pass
        self.ui.hide_for_panel_mode()
        return True

    def _on_votex_window_restore(self) -> bool:
        """Gizlenen pencereyi geri getirir."""
        self.ui.restore_from_panel_mode()
        return True

    # votex_chat poller'ının pencere isteklerini ui callback'lerine köprülediği işleyiciler
    def _handle_votex_window_hide(self, _text: str) -> None:
        self._on_votex_window_hide()

    def _handle_votex_window_restore(self, _text: str) -> None:
        self._on_votex_window_restore()

    async def _send_user_text(self, text: str):
        """Yazi komutu — once client_content (2.5), olmazsa realtime text."""
        if not self.session:
            return
        try:
            await self.session.send_client_content(
                turns={"role": "user", "parts": [{"text": text}]},
                turn_complete=True,
            )
        except Exception:
            try:
                await self.session.send_realtime_input(text=text)
            except Exception as e:
                self.ui.write_log(f"ERR: Yazi gonderilemedi — {e}")
                self.ui.set_state("ERROR")

    async def _interrupt_audio(self):
        try:
            if self.audio_in_queue:
                while not self.audio_in_queue.empty():
                    try:
                        self.audio_in_queue.get_nowait()
                    except Exception:
                        break
            if self.session:
                await self.session.send_realtime_input(audio_stream_end=True)
            self.set_speaking(False)
        except Exception:
            pass

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        else:
            self.ui.set_state("LISTENING")

    def speak_error(self, tool_name: str, error: str):
        short = str(error)[:120]
        self.ui.write_log(f"ERR: {tool_name} — {short}")
        self.ui.write_debug(f"{tool_name}: {short}", level="ERROR")
        self.ui.set_state("ERROR")

    @staticmethod
    def _result_looks_like_error(result) -> bool:
        text = str(result or "").strip().lower()
        if not text:
            return False
        error_markers = (
            "hata:", "error", "alinamadi", "bulunamadi", "acilamadi",
            "tamamlanamadi", "gecersiz", "izin gerekiyor",
            "baglanti kesildi", "baglanti hatasi", "baglantisi henuz",
            "gerekli.", "yapilamadi", "kota", "quota", "resource_exhausted",
        )
        return any(marker in text for marker in error_markers)

    @staticmethod
    def _clean_transcript_text(text: str) -> tuple[str, bool]:
        raw = str(text or "")
        had_noise = False
        if CONTROL_TOKEN_RE.search(raw):
            had_noise = True
            raw = CONTROL_TOKEN_RE.sub(" ", raw)
        cleaned = []
        for ch in raw:
            if ch in "\n\r\t" or ord(ch) >= 32:
                cleaned.append(ch)
            else:
                had_noise = True
        normalized = " ".join("".join(cleaned).split())
        return normalized.strip(), had_noise

    def _build_config(self) -> types.LiveConnectConfig:
        memory = load_memory()
        mem_str = format_memory_for_prompt(memory)
        sys_p = load_system_prompt()
        now = datetime.datetime.now()
        time_ctx = f"[SU ANKI ZAMAN]\n{now.strftime('%A, %d %B %Y — %H:%M')}\n\n"

        parts = [time_ctx]
        if mem_str:
            parts.append(mem_str + "\n\n")
        parts.append(sys_p)

        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription={},
            input_audio_transcription={},
            system_instruction="\n".join(parts),
            tools=[{"function_declarations": TOOL_DECLARATIONS}],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=str(get_app_config_value("voice", "Charon") or "Charon")
                    )
                )
            ),
        )

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})
        print(f"[DTA] tool {name} {args}")
        self.ui.set_state("THINKING")

        loop = asyncio.get_event_loop()
        result = "Tamam."
        had_exception = False

        try:
            if name in LICENSE_GATED_TOOLS:
                allowed, lic_msg = check_tool_allowed(name)
                if not allowed:
                    result = lic_msg
                    print(f"[DTA] {name} blocked: {lic_msg}")
                    return types.FunctionResponse(
                        id=fc.id, name=name,
                        response={"result": result},
                    )

            if name == "save_memory":
                cat = args.get("category", "notes")
                key = args.get("key", "")
                val = args.get("value", "")
                if key and val:
                    update_memory({cat: {key: {"value": val}}})
                result = "ok"

            elif name == "delete_memory":
                result = delete_memory(
                    args.get("category", ""),
                    args.get("key", ""),
                    args.get("match_text", ""),
                )

            elif name == "sys_info":
                self._focus_ui_section_for_tool(name, args)
                r = await loop.run_in_executor(
                    None, lambda: sys_info(args.get("query", "all")))
                result = r or "Bilgi alindi."

            elif name in (
                "analyze_elic_screen",
                "analyze_screen",
                "analyze_votex_screen",
                "analyze_workspace_screens",
            ):
                r = await loop.run_in_executor(
                    None,
                    lambda: analyze_workspace_screens(
                        args.get("query", "Ekranlari yorumla")
                    ),
                )
                result = r or "Ekran analizi tamamlandi."
                if r and not self._result_looks_like_error(r):
                    record_tool_usage(name)

            elif name == "guide_votex":
                r = await loop.run_in_executor(
                    None,
                    lambda: guide_votex(
                        args.get("hints"),
                        bool(args.get("clear", False)),
                        bool(args.get("append", False)),
                        bool(args.get("rebuild", True)),
                        str(args.get("note") or ""),
                    ),
                )
                result = r or "VOTEX yonlendirildi."
                if r and not self._result_looks_like_error(r):
                    record_tool_usage(name)

            elif name == "export_elic_case":
                from actions.elic_case_export import create_field_report
                r = await loop.run_in_executor(None, create_field_report)
                result = r or "ELIC Case kaydedildi."
                if r and not self._result_looks_like_error(r):
                    record_tool_usage(name)

            elif name == "start_survey":
                r = await loop.run_in_executor(
                    None,
                    lambda: start_survey(
                        float(args.get("width_m", 10)),
                        float(args.get("length_m", 10)),
                    ),
                )
                result = r or "Tarama baslatildi."

            elif name == "mark_survey_corner":
                r = await loop.run_in_executor(
                    None,
                    lambda: mark_survey_corner(int(args.get("corner_index", 1))),
                )
                result = r or "Kose isaretlendi."

            elif name == "get_navigation_guidance":
                r = await loop.run_in_executor(None, get_navigation_guidance)
                result = r or "Yonlendirme hazir."

            elif name == "get_survey_status":
                r = await loop.run_in_executor(None, get_survey_status)
                result = r or "Tarama durumu alindi."

            elif name == "recommend_sensor_switch":
                r = await loop.run_in_executor(
                    None,
                    lambda: recommend_sensor_switch(str(args.get("target", "thermal"))),
                )
                result = r or "Sensor onerisi hazir."

            elif name == "verify_with_thermal":
                r = await loop.run_in_executor(None, verify_elic_thermal)
                result = r or "Termal dogrulama tamamlandi."

            else:
                result = f"Bilinmeyen arac: {name}"

        except Exception as e:
            result = f"Hata: {e}"
            had_exception = True
            traceback.print_exc()
            self.speak_error(name, e)

        tool_failed = self._result_looks_like_error(result)
        if tool_failed and not had_exception:
            self.ui.set_state("ERROR")
        elif not tool_failed and not self.ui.muted:
            self.ui.set_state("LISTENING")

        # ELIC yakalama/analiz sonrasi DTA arkada kalmasin
        try:
            self.ui.bring_to_front()
        except Exception:
            pass

        print(f"[DTA] {name} -> {str(result)[:80]}")
        return types.FunctionResponse(
            id=fc.id, name=name,
            response={"result": result}
        )

    async def _send_realtime(self):
        while True:
            msg = await self.out_queue.get()
            await self.session.send_realtime_input(
                audio=types.Blob(
                    data=msg["data"],
                    mime_type="audio/pcm;rate=16000"
                )
            )

    async def _listen_audio(self):
        print("[DTA] Mikrofon baslatiliyor...")
        try:
            pa = await asyncio.to_thread(_get_pyaudio)
        except Exception as e:
            msg = f"Mikrofon atlandi ({e}) — yazi ile sorabilirsiniz"
            print(f"[DTA] {msg}")
            _boot_log(f"[boot] {msg}")
            try:
                self.ui.write_log(f"SYS: {msg}")
            except Exception:
                pass
            while True:
                await asyncio.sleep(3600)

        selected_index = None
        try:
            info = pa.get_host_api_info_by_index(0)
            for i in range(info.get("deviceCount")):
                dev = pa.get_device_info_by_host_api_device_index(0, i)
                if dev.get("maxInputChannels") > 0:
                    name = dev.get("name", "").lower()
                    if "mic" in name or "mikrofon" in name:
                        selected_index = i
                        break
        except Exception:
            pass

        try:
            if selected_index is not None:
                device_info = pa.get_device_info_by_host_api_device_index(0, selected_index)
            else:
                device_info = pa.get_default_input_device_info()
            native_rate = int(device_info["defaultSampleRate"])
        except Exception:
            native_rate = 48000

        try:
            stream = await asyncio.to_thread(
                pa.open,
                format=FORMAT,
                channels=CHANNELS,
                rate=native_rate,
                input=True,
                input_device_index=selected_index,
                frames_per_buffer=CHUNK_SIZE,
            )
        except Exception as e:
            msg = f"Mikrofon acilamadi ({e}) — yazi ile devam"
            print(f"[DTA] {msg}")
            _boot_log(f"[boot] {msg}")
            try:
                self.ui.write_log(f"SYS: {msg}")
            except Exception:
                pass
            while True:
                await asyncio.sleep(3600)

        try:
            import audioop
            state = None
            while True:
                data = await asyncio.to_thread(
                    stream.read, CHUNK_SIZE, exception_on_overflow=False)

                if native_rate != SEND_SAMPLE_RATE:
                    data, state = audioop.ratecv(
                        data, 2, CHANNELS, native_rate, SEND_SAMPLE_RATE, state)

                with self._speaking_lock:
                    jarvis_speaking = self._is_speaking

                if not self._paused:
                    if jarvis_speaking or self.ui.muted:
                        # Sessizlik/mute paketleri Live oturumunu tıkayabiliyor — gönderme
                        continue
                    rms = audioop.rms(data, 2)
                    if rms < 400:
                        continue
                    try:
                        self.out_queue.put_nowait({"data": data, "mime_type": "audio/pcm"})
                    except asyncio.QueueFull:
                        pass
        finally:
            stream.close()

    async def _receive_audio(self):
        out_buf, in_buf = [], []
        output_noise = False
        output_noise_samples = []
        try:
            while True:
                async for response in self.session.receive():
                    if response.data:
                        self.audio_in_queue.put_nowait(response.data)

                    if response.server_content:
                        sc = response.server_content

                        if sc.output_transcription and sc.output_transcription.text:
                            self.set_speaking(True)
                            raw_txt = sc.output_transcription.text.strip()
                            if raw_txt:
                                txt, had_noise = self._clean_transcript_text(raw_txt)
                                if had_noise:
                                    output_noise = True
                                    if len(output_noise_samples) < 4:
                                        output_noise_samples.append(raw_txt)
                                if txt:
                                    out_buf.append(txt)

                        # 2.5 native-audio bazen transcript yerine model_turn.text dondurur
                        mt = getattr(sc, "model_turn", None)
                        if mt is not None:
                            for part in getattr(mt, "parts", None) or []:
                                raw_txt = str(getattr(part, "text", None) or "").strip()
                                if not raw_txt:
                                    continue
                                self.set_speaking(True)
                                txt, had_noise = self._clean_transcript_text(raw_txt)
                                if had_noise:
                                    output_noise = True
                                if txt:
                                    out_buf.append(txt)

                        if sc.input_transcription and sc.input_transcription.text:
                            txt = sc.input_transcription.text.strip()
                            if txt:
                                in_buf.append(txt)
                                self.ui.mark_user_activity(True)

                        if sc.turn_complete:
                            self.set_speaking(False)

                            full_in = " ".join(in_buf).strip()
                            if full_in:
                                self.ui.write_log(f"Siz: {full_in}")
                            in_buf = []

                            full_out = " ".join(out_buf).strip()
                            if full_out:
                                self.ui.write_log(f"DTA: {full_out}")
                            elif output_noise:
                                self.ui.write_log("ERR: Sesli yanit cozumlenemedi.")
                                self.ui.set_state("ERROR")
                            out_buf = []

                            # Konuşma turunu VOTEX paneline it (localhost köprüsü)
                            self._push_votex_chat(full_in, full_out)
                            output_noise = False
                            output_noise_samples = []

                    if response.tool_call:
                        fn_responses = []
                        for fc in response.tool_call.function_calls:
                            fr = await self._execute_tool(fc)
                            fn_responses.append(fr)
                        await self.session.send_tool_response(
                            function_responses=fn_responses)

        except Exception as e:
            print(f"[DTA] Alim hatasi: {e}")
            traceback.print_exc()
            raise

    async def _play_audio(self):
        try:
            pa = await asyncio.to_thread(_get_pyaudio)
            stream = await asyncio.to_thread(
                pa.open,
                format=FORMAT, channels=CHANNELS,
                rate=RECV_SAMPLE_RATE, output=True,
            )
        except Exception as e:
            msg = f"Hoparlor atlandi ({e}) — yanitlar yazida gorunur"
            print(f"[DTA] {msg}")
            _boot_log(f"[boot] {msg}")
            try:
                self.ui.write_log(f"SYS: {msg}")
            except Exception:
                pass
            while True:
                chunk = await self.audio_in_queue.get()
                # Ses yok; kuyruk birikmesin, konusma durumunu serbest birak
                self.set_speaking(False)
                del chunk

        try:
            while True:
                chunk = await self.audio_in_queue.get()
                self.set_speaking(True)
                await asyncio.to_thread(stream.write, chunk)
                if self.audio_in_queue.empty():
                    self.set_speaking(False)
        finally:
            self.set_speaking(False)
            stream.close()

    async def _connect_live(self, client, config):
        """Canli modele baglan; desteklenmeyen modelde siradaki yedegi dene."""
        last_err: Exception | None = None
        models = list(dict.fromkeys([LIVE_MODEL, *LIVE_MODELS]))

        for model_name in models:
            cm = client.aio.live.connect(model=model_name, config=config)
            try:
                print(f"[DTA] Baglaniyor ({model_name})...")
                _boot_log(f"[boot] Live baglaniyor model={model_name}")
                try:
                    self.ui.write_log(f"SYS: Baglaniyor ({model_name})...")
                except Exception:
                    pass
                session = await asyncio.wait_for(cm.__aenter__(), timeout=45.0)
                _boot_log(f"[boot] Live baglandi model={model_name}")
                return cm, session, model_name
            except Exception as e:
                last_err = e
                print(f"[DTA] model {model_name} basarisiz: {e}")
                _boot_log(f"[boot] Live hata model={model_name}: {e}")
                try:
                    await cm.__aexit__(type(e), e, e.__traceback__)
                except Exception:
                    pass
        raise last_err or RuntimeError("Live modele baglanilamadi")

    async def run(self):
        client = genai.Client(
            api_key=get_api_key(),
            http_options={"api_version": "v1alpha"}
        )

        while True:
            if self._paused:
                await asyncio.sleep(1)
                continue

            cm = None
            try:
                self.ui.set_state("THINKING")
                config = self._build_config()
                cm, session, model_name = await self._connect_live(client, config)

                async with asyncio.TaskGroup() as tg:
                    self.session = session
                    self._loop = asyncio.get_event_loop()
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue = asyncio.Queue(maxsize=10)

                    print(f"[DTA] Baglandi ({model_name}).")
                    # Pencere gizle/geri getir işleyicilerini bağla + poller'ı başlat
                    votex_chat.set_window_handlers(
                        self._handle_votex_window_hide,
                        self._handle_votex_window_restore,
                    )
                    # VOTEX panel mesajlarını çekmeye başla (idempotent)
                    votex_chat.start_panel_message_poller(self._on_votex_panel_message)
                    self.ui.set_state("LISTENING")
                    self.ui.write_log(
                        f"SYS: {get_product_name()} hazir ({model_name}). "
                        "Dinliyorum — yazi da calisir."
                    )

                    tg.create_task(self._send_realtime())
                    tg.create_task(self._listen_audio())
                    tg.create_task(self._receive_audio())
                    tg.create_task(self._play_audio())

            except Exception as e:
                err = str(e)
                print(f"[DTA] {e}")
                traceback.print_exc()
                self.set_speaking(False)
                self.session = None
                # Kullaniciya daha net mesaj
                low = err.lower()
                if "1008" in err or "not found" in low or "not supported" in low:
                    tip = "Live model desteklenmiyor — internet/API anahtarini kontrol edin."
                elif "429" in err or "quota" in low or "resource" in low:
                    tip = "Gemini kotasi doldu — bir dakika bekleyip tekrar deneyin."
                elif "401" in err or "403" in err or "api key" in low:
                    tip = "API anahtari gecersiz — config/api_keys.json kontrol edin."
                elif "timeout" in low or "timed out" in low:
                    tip = "Live baglanti zaman asimi — interneti kontrol edip tekrar deneyin."
                else:
                    tip = err[:160]
                self.ui.write_log(f"ERR: Baglanti kesildi — {tip}")
                self.ui.set_state("ERROR")
                await asyncio.sleep(3)
            finally:
                if cm is not None:
                    try:
                        await cm.__aexit__(None, None, None)
                    except Exception:
                        pass


def main():
    try:
        if BOOT_LOG.exists():
            BOOT_LOG.unlink()
    except Exception:
        pass
    _boot_log("[boot] UI aciliyor (agir kutuphaneler sonra)...")
    ui = JarvisUI()
    _boot_log("[boot] UI hazir — mainloop")
    try:
        ui.write_log("SYS: Arayuz acildi, baglanti hazirlaniyor...")
    except Exception:
        pass

    def runner():
        try:
            _load_heavy_runtime()
            # Asla main thread'de wait_for_license — mainloop kilitlenir (tablette kum saati)
            from core.license_policy import is_enforcement_enabled
            if is_enforcement_enabled():
                ui.wait_for_license()
            ui.wait_for_api_key()
            jarvis = JarvisLive(ui)
            asyncio.run(jarvis.run())
        except KeyboardInterrupt:
            print("\nKapatiliyor...")
        except Exception as e:
            _boot_log(f"[boot] HATA: {e}")
            traceback.print_exc()
            try:
                ui.write_log(f"ERR: Baslatma hatasi — {e}")
                ui.set_state("ERROR")
            except Exception:
                pass

    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()


if __name__ == "__main__":
    main()
