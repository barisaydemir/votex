#!/usr/bin/env python3
"""
Derin Tarama Asistan — açılış / kurulum penceresi (baslat.bat yerine).
Venv yoksa kurar, sonra main.py'yi konsolsuz başlatır.
"""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENV_DIR = BASE_DIR / ".venv_jarvis"
VENV_PY = VENV_DIR / "Scripts" / "python.exe"
VENV_PYW = VENV_DIR / "Scripts" / "pythonw.exe"
EMBED_PY = BASE_DIR / "runtime" / "python312-amd64" / "python.exe"
EMBED_PYW = BASE_DIR / "runtime" / "python312-amd64" / "pythonw.exe"
WHEELS = BASE_DIR / "wheels"
REQ = BASE_DIR / "requirements.txt"
MAIN = BASE_DIR / "main.py"
BOOT_LOG = BASE_DIR / "logs" / "boot.log"

# DTA UI paleti (ui.py ile uyumlu)
C_BG = "#020617"
C_PRI = "#3b82f6"
C_TEXT = "#bfdbfe"
C_MUTED = "#64748b"
C_RED = "#ef4444"
C_PANEL = "#0b1120"
C_DIM = "#1e293b"

WIN_W, WIN_H = 420, 280
PRODUCT = "Derin Tarama Asistan"
SPLASH_TITLE = "Derin Tarama Asistan · Açılış"


def _boot_log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} [launcher] {msg}"
    try:
        BOOT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with BOOT_LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass
    try:
        print(line, flush=True)
    except Exception:
        pass


def _dpi_aware() -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def _find_bootstrap_python() -> list[str]:
    """venv kuracak host: önce gömülü runtime, sonra sistem."""
    if EMBED_PY.is_file():
        return [str(EMBED_PY)]
    if Path(sys.executable).name.lower() in ("python.exe", "pythonw.exe", "py.exe"):
        return [sys.executable]
    candidates = [
        ["py", "-3.12"],
        ["py", "-3"],
        ["python"],
        ["python3"],
    ]
    for cmd in candidates:
        try:
            r = subprocess.run(
                [*cmd, "-c", "import sys; print(sys.version)"],
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=_no_window_flags(),
            )
            if r.returncode == 0:
                return cmd
        except Exception:
            continue
    return [sys.executable]


def _no_window_flags() -> int:
    if sys.platform == "win32":
        return getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return 0


def _venv_ready() -> bool:
    return VENV_PY.is_file() and MAIN.is_file()


def _run_logged(cmd: list[str], on_line, cwd: Path | None = None) -> int:
    _boot_log("run: " + " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd or BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=_no_window_flags(),
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            _boot_log(line)
            on_line(line[:120])
    return proc.wait()


def ensure_venv(on_status, on_progress) -> None:
    if _venv_ready():
        on_status("Ortam hazır")
        on_progress(0.35)
        return

    if not REQ.is_file():
        raise FileNotFoundError(f"requirements.txt yok: {REQ}")

    host = _find_bootstrap_python()
    on_status("Python ortamı kuruluyor…")
    on_progress(0.08)
    code = _run_logged(
        [*host, "-m", "venv", str(VENV_DIR)],
        on_line=lambda s: on_status(f"venv: {s}"),
    )
    if code != 0 or not VENV_PY.is_file():
        raise RuntimeError(f"venv kurulumu başarısız (kod {code})")

    on_status("Kütüphaneler kuruluyor…")
    on_progress(0.25)
    if WHEELS.is_dir() and any(WHEELS.glob("*.whl")):
        pip = [
            str(VENV_PY),
            "-m",
            "pip",
            "install",
            "--no-index",
            f"--find-links={WHEELS}",
            "-r",
            str(REQ),
        ]
        on_status("Offline wheels kuruluyor…")
    else:
        pip = [str(VENV_PY), "-m", "pip", "install", "-r", str(REQ)]
    code = _run_logged(
        pip,
        on_line=lambda s: on_status(s if len(s) < 80 else s[:77] + "…"),
    )
    if code != 0 and WHEELS.is_dir():
        # wheels eksik paket → internet fallback
        on_status("Eksikler internetten tamamlanıyor…")
        code = _run_logged(
            [str(VENV_PY), "-m", "pip", "install", "-r", str(REQ)],
            on_line=lambda s: on_status(s if len(s) < 80 else s[:77] + "…"),
        )
    if code != 0:
        raise RuntimeError(f"pip install başarısız (kod {code})")
    on_progress(0.55)
    on_status("Kurulum tamam")


def spawn_main() -> subprocess.Popen:
    py = VENV_PYW if VENV_PYW.is_file() else VENV_PY
    if not py.is_file():
        raise FileNotFoundError(f"Python yok: {py}")
    if not MAIN.is_file():
        raise FileNotFoundError(f"main.py yok: {MAIN}")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    flags = _no_window_flags()
    # pythonw zaten konsolsuz; CREATE_NO_WINDOW yine güvenli
    return subprocess.Popen(
        [str(py), str(MAIN.name)],
        cwd=str(BASE_DIR),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
    )


class SplashApp:
    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.root = tk.Tk()
        self.root.title(SPLASH_TITLE)
        self.root.configure(bg=C_BG)
        self.root.resizable(False, False)
        self.root.attributes("-topmost", True)
        try:
            self.root.overrideredirect(False)
        except Exception:
            pass

        self._center()
        self.status_var = tk.StringVar(value="Hazırlanıyor…")
        self.error_var = tk.StringVar(value="")
        self._progress = 0.0
        self._worker: threading.Thread | None = None
        self._closed = False

        frame = tk.Frame(self.root, bg=C_BG, padx=28, pady=24)
        frame.pack(fill="both", expand=True)

        tk.Label(
            frame,
            text=PRODUCT,
            font=("Segoe UI Semibold", 18),
            fg=C_TEXT,
            bg=C_BG,
        ).pack(anchor="w")

        tk.Label(
            frame,
            text="DTA · Digital Future Tech",
            font=("Segoe UI", 9),
            fg=C_MUTED,
            bg=C_BG,
        ).pack(anchor="w", pady=(4, 20))

        self.status_lbl = tk.Label(
            frame,
            textvariable=self.status_var,
            font=("Segoe UI", 11),
            fg=C_PRI,
            bg=C_BG,
            wraplength=360,
            justify="left",
            anchor="w",
        )
        self.status_lbl.pack(fill="x", anchor="w")

        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure(
            "Dta.Horizontal.TProgressbar",
            troughcolor=C_DIM,
            background=C_PRI,
            bordercolor=C_PANEL,
            lightcolor=C_PRI,
            darkcolor=C_PRI,
        )
        self.bar = ttk.Progressbar(
            frame,
            style="Dta.Horizontal.TProgressbar",
            mode="determinate",
            maximum=100,
            length=360,
        )
        self.bar.pack(pady=(16, 8), anchor="w")
        self.bar["value"] = 5

        self.err_lbl = tk.Label(
            frame,
            textvariable=self.error_var,
            font=("Segoe UI", 9),
            fg=C_RED,
            bg=C_BG,
            wraplength=360,
            justify="left",
            anchor="w",
        )
        self.err_lbl.pack(fill="x", anchor="w", pady=(4, 0))

        btn_row = tk.Frame(frame, bg=C_BG)
        btn_row.pack(fill="x", pady=(16, 0))
        self.retry_btn = tk.Button(
            btn_row,
            text="Tekrar dene",
            command=self._start_worker,
            bg=C_PANEL,
            fg=C_TEXT,
            activebackground=C_DIM,
            activeforeground=C_TEXT,
            relief="flat",
            padx=12,
            pady=6,
            font=("Segoe UI", 9),
            state="disabled",
        )
        self.retry_btn.pack(side="left")
        self.close_btn = tk.Button(
            btn_row,
            text="Kapat",
            command=self._close,
            bg=C_PANEL,
            fg=C_TEXT,
            activebackground=C_DIM,
            activeforeground=C_TEXT,
            relief="flat",
            padx=12,
            pady=6,
            font=("Segoe UI", 9),
        )
        self.close_btn.pack(side="right")

        self.root.protocol("WM_DELETE_WINDOW", self._close)
        self._start_worker()
        # Kısa süre üstte kal; sonra diğer pencerelerin altına inebilir
        self.root.after(2500, lambda: self._safe_topmost(False))

    def _center(self) -> None:
        self.root.geometry(f"{WIN_W}x{WIN_H}")
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - WIN_W) // 2)
        y = max(0, (sh - WIN_H) // 3)
        self.root.geometry(f"{WIN_W}x{WIN_H}+{x}+{y}")

    def _safe_topmost(self, on: bool) -> None:
        if self._closed:
            return
        try:
            self.root.attributes("-topmost", on)
        except Exception:
            pass

    def set_status(self, text: str) -> None:
        self.root.after(0, lambda: self.status_var.set(text))

    def set_progress(self, frac: float) -> None:
        frac = max(0.0, min(1.0, frac))

        def _apply() -> None:
            self._progress = frac
            self.bar["value"] = int(frac * 100)

        self.root.after(0, _apply)

    def show_error(self, msg: str) -> None:
        def _apply() -> None:
            self.error_var.set(msg)
            self.status_var.set("Başlatılamadı")
            self.retry_btn.configure(state="normal")
            self.bar["value"] = 0

        self.root.after(0, _apply)

    def _start_worker(self) -> None:
        self.retry_btn.configure(state="disabled")
        self.error_var.set("")
        self.status_var.set("Hazırlanıyor…")
        self.bar["value"] = 5
        self._worker = threading.Thread(target=self._work, daemon=True)
        self._worker.start()

    def _work(self) -> None:
        try:
            ensure_venv(self.set_status, self.set_progress)
            self.set_status("Başlatılıyor…")
            self.set_progress(0.7)
            proc = spawn_main()
            _boot_log(f"main.py pid={proc.pid}")
            self.set_progress(0.9)
            # Ana UI açılana kadar kısa bekle; sonra splash kapanır
            time.sleep(1.6)
            if proc.poll() is not None and proc.returncode not in (None, 0):
                raise RuntimeError(f"main.py erken çıktı (kod {proc.returncode})")
            self.set_status("Açıldı")
            self.set_progress(1.0)
            time.sleep(0.35)
            self.root.after(0, self._close)
        except Exception as e:
            _boot_log("ERROR: " + "".join(traceback.format_exception(e)))
            self.show_error(str(e))

    def _close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.root.destroy()
        except Exception:
            pass

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    os.chdir(BASE_DIR)
    _dpi_aware()
    _boot_log("splash start")
    try:
        SplashApp().run()
    except Exception as e:
        _boot_log("fatal: " + str(e))
        # Son çare: mesaj kutusu
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                0,
                f"DTA açılamadı:\n{e}",
                SPLASH_TITLE,
                0x10,
            )
        except Exception:
            pass
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
