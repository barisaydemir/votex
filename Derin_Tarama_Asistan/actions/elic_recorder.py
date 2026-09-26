# ELIC Asistan — Barış Aydemir / Digital Future Tech
"""Proton ELIC ekran kaydi: basla / bekle / bitir, kare kare yakalama, video."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image

from app_config import get_app_config_value
from actions.windows_utils import capture_window

BASE_DIR = Path(__file__).resolve().parent.parent
RECORDINGS_DIR = BASE_DIR / "recordings"

# ELIC heatmap yavas degisir; 2 fps yeterli ve tablette hafiftir.
DEFAULT_FPS = 2.0


def _capture_quiet(target: str) -> tuple[bool, str, Image.Image | None, str]:
    """ELIC penceresini odak calmadan TAM yakala (surekli kayit)."""
    try:
        ok, detail, payload = capture_window(target)
        if not ok:
            return False, detail, None, ""
        path = Path(str(payload.get("image_path", "") or ""))
        title = str(payload.get("window_title", "") or target)
        if not path.exists():
            return False, "Yakalama dosyasi yok.", None, title
        image = Image.open(path).convert("RGB")
        try:
            path.unlink()
        except Exception:
            pass
        return True, "ok", image, title
    except Exception as exc:
        return False, str(exc), None, ""


class ElicRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._running = False
        self._paused = False
        self._session_dir: Path | None = None
        self._frames_dir: Path | None = None
        self._frame_count = 0
        self._fps = DEFAULT_FPS
        self._started_at: str | None = None
        self._window_title = ""
        self._last_error = ""
        self._status_message = "Hazir"
        self._on_status = None  # optional callback(str)

    def set_status_callback(self, callback) -> None:
        self._on_status = callback

    def _emit(self, message: str) -> None:
        self._status_message = message
        if self._on_status:
            try:
                self._on_status(message)
            except Exception:
                pass

    def status(self) -> dict[str, Any]:
        with self._lock:
            if self._running and self._paused:
                state = "paused"
            elif self._running:
                state = "recording"
            else:
                state = "idle"
            return {
                "state": state,
                "frame_count": self._frame_count,
                "session_dir": str(self._session_dir) if self._session_dir else "",
                "fps": self._fps,
                "message": self._status_message,
                "last_error": self._last_error,
                "window_title": self._window_title,
            }

    def start(self, fps: float | None = None) -> str:
        with self._lock:
            if self._running and not self._paused:
                return "Kayit zaten devam ediyor."
            if self._running and self._paused:
                self._paused = False
                self._emit(f"Kayit devam: {self._frame_count} kare")
                return "Kayda devam edildi."

            target = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC")
            ok, detail, _img, title = _capture_quiet(target)
            if not ok:
                self._last_error = detail
                return f"ELIC ekrani alinamadi: {detail}"

            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            self._session_dir = RECORDINGS_DIR / f"elic_{stamp}"
            self._frames_dir = self._session_dir / "frames"
            self._frames_dir.mkdir(parents=True, exist_ok=True)
            self._frame_count = 0
            self._fps = max(0.5, float(fps or DEFAULT_FPS))
            self._started_at = datetime.now().isoformat(timespec="seconds")
            self._window_title = title or target
            self._last_error = ""
            self._running = True
            self._paused = False

            meta = {
                "started_at": self._started_at,
                "window_title": self._window_title,
                "fps": self._fps,
                "target": target,
            }
            (self._session_dir / "session.json").write_text(
                json.dumps(meta, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            self._thread = threading.Thread(target=self._loop, daemon=True)
            self._thread.start()
            self._emit("Kayit basladi")
            return f"Kayit basladi: {self._session_dir.name}"

    def pause(self) -> str:
        with self._lock:
            if not self._running:
                return "Aktif kayit yok."
            if self._paused:
                return "Kayit zaten bekletiliyor."
            self._paused = True
            self._emit(f"Beklemede · {self._frame_count} kare")
            return f"Kayit bekletildi. {self._frame_count} kare kaydedildi."

    def resume(self) -> str:
        with self._lock:
            if not self._running:
                return "Aktif kayit yok. Once Basla'ya basin."
            if not self._paused:
                return "Kayit zaten devam ediyor."
            self._paused = False
            self._emit(f"Kayit devam: {self._frame_count} kare")
            return "Kayda devam edildi."

    def stop(self) -> str:
        with self._lock:
            if not self._running and self._session_dir is None:
                return "Aktif kayit yok."
            self._running = False
            self._paused = False
            session = self._session_dir
            frames_dir = self._frames_dir
            count = self._frame_count
            fps = self._fps

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)
        self._thread = None

        if not session or not frames_dir or count <= 0:
            self._emit("Kayit bitti (kare yok)")
            return "Kayit bitti ama kare yok. ELIC acik miydi?"

        self._emit(f"Video hazirlaniyor · {count} kare...")
        video_path, video_kind = self._export_video(session, frames_dir, fps)
        meta_path = session / "session.json"
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        meta.update({
            "ended_at": datetime.now().isoformat(timespec="seconds"),
            "frame_count": count,
            "video_path": str(video_path) if video_path else "",
            "video_kind": video_kind,
            "frames_dir": str(frames_dir),
        })
        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

        if video_path:
            msg = f"Kayit bitti: {count} kare → {video_path.name} ({session})"
            self._emit(f"Bitti · {count} kare · {video_path.name}")
        else:
            msg = f"Kayit bitti: {count} kare PNG klasorde. Video yazilamadi: {self._last_error}"
            self._emit(f"Bitti · {count} kare (PNG)")
        return msg

    def _loop(self) -> None:
        target = str(get_app_config_value("elic_window_title", "Proton ELIC") or "Proton ELIC")
        interval = 1.0 / max(0.5, self._fps)
        while True:
            with self._lock:
                if not self._running:
                    break
                paused = self._paused
                frames_dir = self._frames_dir

            if paused or frames_dir is None:
                time.sleep(0.15)
                continue

            t0 = time.perf_counter()
            ok, detail, image, title = _capture_quiet(target)
            if ok and image is not None:
                with self._lock:
                    self._frame_count += 1
                    idx = self._frame_count
                    if title:
                        self._window_title = title
                out = frames_dir / f"frame_{idx:06d}.png"
                try:
                    # Kirpma / 1280'e indirme YOK — tam ELIC kadrajı kalsın
                    image.save(out, format="PNG", optimize=True)
                    if idx == 1 or idx % 10 == 0:
                        self._emit(f"Kayit · {idx} kare · {image.size[0]}x{image.size[1]}")
                except Exception as exc:
                    self._last_error = str(exc)
            else:
                self._last_error = detail
                self._emit(f"ELIC bulunamadi · {self._frame_count} kare")

            elapsed = time.perf_counter() - t0
            sleep_for = max(0.01, interval - elapsed)
            time.sleep(sleep_for)

    def _export_video(self, session: Path, frames_dir: Path, fps: float) -> tuple[Path | None, str]:
        frames = sorted(frames_dir.glob("frame_*.png"))
        if not frames:
            return None, "none"

        mp4_path = session / "elic_capture.mp4"
        gif_path = session / "elic_capture.gif"

        # 1) imageio + ffmpeg (tercih)
        try:
            import imageio.v2 as imageio

            writer = imageio.get_writer(str(mp4_path), fps=fps, codec="libx264", quality=8)
            try:
                for path in frames:
                    writer.append_data(imageio.imread(path))
            finally:
                writer.close()
            if mp4_path.exists() and mp4_path.stat().st_size > 0:
                return mp4_path, "mp4"
        except Exception as exc:
            self._last_error = f"mp4: {exc}"

        # 2) Pillow GIF yedek
        try:
            images = [Image.open(p).convert("RGB") for p in frames]
            duration = max(50, int(1000 / max(0.5, fps)))
            images[0].save(
                gif_path,
                save_all=True,
                append_images=images[1:],
                duration=duration,
                loop=0,
                optimize=True,
            )
            for im in images:
                im.close()
            if gif_path.exists():
                return gif_path, "gif"
        except Exception as exc:
            self._last_error = f"gif: {exc}"

        return None, "frames_only"


# Tek global kayitci
_recorder = ElicRecorder()


def get_recorder() -> ElicRecorder:
    return _recorder


def start_recording(fps: float = DEFAULT_FPS) -> str:
    return _recorder.start(fps=fps)


def pause_recording() -> str:
    return _recorder.pause()


def resume_recording() -> str:
    return _recorder.resume()


def stop_recording() -> str:
    return _recorder.stop()


def recording_status() -> dict[str, Any]:
    return _recorder.status()
