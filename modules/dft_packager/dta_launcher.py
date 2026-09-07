#!/usr/bin/env python3
"""
Derin Tarama Asistan — taşınabilir açılış.

Saha PC'de venv KULLANILMAZ (build-PC yolu / embed venv kırılır).
Paketler gömülü runtime\\python312-amd64\\Lib\\site-packages içine kurulur.
Tkinter yoksa bile kurulum + açılış dener; hata MessageBox ile gösterilir.
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
EMBED_DIR = BASE_DIR / "runtime" / "python312-amd64"
EMBED_PY = EMBED_DIR / "python.exe"
EMBED_PYW = EMBED_DIR / "pythonw.exe"
GET_PIP = EMBED_DIR / "get-pip.py"
WHEELS = BASE_DIR / "wheels"
REQ = BASE_DIR / "requirements.txt"
MAIN = BASE_DIR / "main.py"
BOOT_LOG = BASE_DIR / "logs" / "boot.log"

C_BG = "#020617"
C_PRI = "#3b82f6"
C_TEXT = "#bfdbfe"
C_MUTED = "#64748b"
C_RED = "#ef4444"
C_PANEL = "#0b1120"
C_DIM = "#1e293b"

WIN_W, WIN_H = 420, 300
PRODUCT = "Derin Tarama Asistan"
SPLASH_TITLE = "Derin Tarama Asistan · Açılış"

UI_IMPORT = "import tkinter, PIL, psutil"
FULL_IMPORT = "import google.genai, PIL, flask, requests, psutil"


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


def _no_window_flags() -> int:
    if sys.platform == "win32":
        return getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
    return 0


def _message_box(text: str, title: str = "DTA açılış hatası") -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, str(text)[-1200:], title, 0x10)
    except Exception:
        pass


def _embed_import_ok(code: str) -> bool:
    if not EMBED_PY.is_file():
        return False
    try:
        r = subprocess.run(
            [str(EMBED_PY), "-c", code],
            capture_output=True,
            timeout=45,
            creationflags=_no_window_flags(),
            cwd=str(EMBED_DIR),
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or b"").decode("utf-8", "replace")[-200:]
            if err:
                _boot_log(f"import fail ({code[:40]}): {err}")
        return r.returncode == 0
    except Exception as e:
        _boot_log(f"import test: {e}")
        return False


def _ui_ready() -> bool:
    return (EMBED_DIR / "_tkinter.pyd").is_file() and _embed_import_ok(UI_IMPORT)


def _full_ready() -> bool:
    marker = EMBED_DIR / "Lib" / "site-packages" / "google" / "genai"
    return marker.is_dir() and _embed_import_ok(FULL_IMPORT)


def _deps_in_embed() -> bool:
    """Geriye uyum: tam paket seti gömülü mü?"""
    return _full_ready()


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


def _ensure_vcredist(on_status) -> None:
    sys32 = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32"
    if (sys32 / "VCRUNTIME140_1.dll").is_file():
        return
    exe = BASE_DIR / "VC_redist.x64.exe"
    if not exe.is_file():
        _boot_log("VC++ yok — VC_redist.x64.exe pakette değil")
        return
    on_status("VC++ kuruluyor…")
    try:
        subprocess.run(
            [str(exe), "/install", "/quiet", "/norestart"],
            timeout=300,
            creationflags=_no_window_flags(),
        )
    except Exception as e:
        _boot_log(f"VC++: {e}")


def _ensure_pip(on_status) -> None:
    if not EMBED_PY.is_file():
        raise FileNotFoundError(f"Gömülü Python yok: {EMBED_PY}")
    probe = subprocess.run(
        [str(EMBED_PY), "-m", "pip", "--version"],
        capture_output=True,
        timeout=30,
        creationflags=_no_window_flags(),
        cwd=str(EMBED_DIR),
    )
    if probe.returncode == 0:
        return
    get_pip = GET_PIP if GET_PIP.is_file() else (BASE_DIR / "get-pip.py")
    if not get_pip.is_file():
        raise FileNotFoundError("pip yok ve get-pip.py bulunamadı")
    on_status("pip kuruluyor…")
    code = _run_logged(
        [str(EMBED_PY), str(get_pip), "--no-warn-script-location"],
        on_line=lambda s: on_status(s[:80]),
        cwd=EMBED_DIR,
    )
    if code != 0:
        raise RuntimeError(f"pip kurulumu başarısız (kod {code})")


def _pip_install(on_status, extra: list[str]) -> int:
    cmd = [
        str(EMBED_PY),
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-warn-script-location",
        *extra,
    ]
    return _run_logged(cmd, on_line=lambda s: on_status(s[:80] if len(s) < 80 else s[:77] + "…"))


def ensure_embed_packages(on_status, on_progress) -> None:
    """Paketleri gömülü Python site-packages'a kur. venv yok."""
    if not EMBED_PY.is_file():
        raise FileNotFoundError(
            "Gömülü Python yok (runtime\\python312-amd64\\python.exe). "
            "Paketi hazirla-kurulum ile yeniden üretin."
        )
    if not MAIN.is_file():
        raise FileNotFoundError(f"main.py yok: {MAIN}")

    _ensure_vcredist(on_status)
    on_progress(0.12)

    if _full_ready():
        on_status("Gömülü paketler hazır")
        on_progress(0.7)
        return
    if _ui_ready():
        on_status("Arayüz paketleri var — eksikler tamamlanıyor…")
    else:
        on_status("Saha ortamı kuruluyor (gömülü Python)…")

    _ensure_pip(on_status)
    on_progress(0.22)

    if not REQ.is_file():
        raise FileNotFoundError(f"requirements.txt yok: {REQ}")

    wheels_ok = WHEELS.is_dir() and any(WHEELS.glob("*.whl"))
    if wheels_ok:
        on_status("Offline wheels kuruluyor…")
        on_progress(0.3)
        code = _pip_install(
            on_status,
            [
                "--no-index",
                f"--find-links={WHEELS}",
                "--prefer-binary",
                "-r",
                str(REQ),
            ],
        )
        if code != 0:
            on_status("Eksikler internetten tamamlanıyor…")
            code = _pip_install(on_status, ["--prefer-binary", "-r", str(REQ)])
    else:
        on_status("Paketler internetten kuruluyor…")
        on_progress(0.3)
        code = _pip_install(on_status, ["--prefer-binary", "-r", str(REQ)])

    if _full_ready() or _ui_ready():
        on_progress(0.7)
        on_status("Kurulum tamam")
        return

    raise RuntimeError(
        f"DTA paket kurulumu başarısız (kod {code}). "
        "wheels klasörü eksik veya internet yok. "
        "Build PC'de hazirla-kurulum ile paketleri gömün. Log: logs\\boot.log"
    )


def ensure_venv(on_status, on_progress) -> None:
    """Eski ad — artık gömülü site-packages kullanır."""
    ensure_embed_packages(on_status, on_progress)


def spawn_main() -> subprocess.Popen:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONNOUSERSITE"] = "1"
    vendor = str((BASE_DIR / "vendor").resolve())
    base = str(BASE_DIR.resolve())
    run_py = BASE_DIR / "run_dta.py"
    if not run_py.is_file():
        run_py.write_text(
            "import runpy,sys\n"
            "from pathlib import Path\n"
            "B=Path(__file__).resolve().parent\n"
            "for p in ("
            " B/'runtime'/'python312-amd64'/'Lib'/'site-packages',"
            " B/'.venv_jarvis'/'Lib'/'site-packages',"
            " B/'vendor', B):\n"
            "    s=str(p)\n"
            "    if p.is_dir() and s not in sys.path: sys.path.insert(0,s)\n"
            "runpy.run_path(str(B/'main.py'), run_name='__main__')\n",
            encoding="utf-8",
        )
    env["PYTHONPATH"] = os.pathsep.join(
        [base, vendor] + ([env["PYTHONPATH"]] if env.get("PYTHONPATH") else [])
    )
    flags = _no_window_flags()

    log_out = BOOT_LOG.parent / "main_spawn.log"
    try:
        BOOT_LOG.parent.mkdir(parents=True, exist_ok=True)
        log_f = open(log_out, "a", encoding="utf-8")
        log_f.write(f"\n--- spawn {time.strftime('%Y-%m-%dT%H:%M:%S')} ---\n")
        log_f.write(f"run={run_py}\nbase={base}\n")
        log_f.flush()
    except Exception:
        log_f = subprocess.DEVNULL

    if EMBED_PY.is_file():
        py = EMBED_PY
    elif EMBED_PYW.is_file():
        py = EMBED_PYW
    elif VENV_PY.is_file():
        py = VENV_PY
    elif VENV_PYW.is_file():
        py = VENV_PYW
    else:
        raise FileNotFoundError("Python yok: runtime\\python312-amd64\\python.exe")
    if not MAIN.is_file():
        raise FileNotFoundError(f"main.py yok: {MAIN}")

    _boot_log(f"spawn: {py} -> {run_py.name} ui={_ui_ready()} full={_full_ready()}")
    return subprocess.Popen(
        [str(py), str(run_py.resolve())],
        cwd=base,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log_f,
        stderr=subprocess.STDOUT,
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
            font=("Segoe UI", 10),
            fg=C_TEXT,
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
        self.root.after(2500, lambda: self._safe_topmost(False))

    def _center(self) -> None:
        self.root.update_idletasks()
        sw = self.root.winfo_screenwidth()
        sh = self.root.winfo_screenheight()
        x = max(0, (sw - WIN_W) // 2)
        y = max(0, (sh - WIN_H) // 3)
        self.root.geometry(f"{WIN_W}x{WIN_H}+{x}+{y}")

    def _safe_topmost(self, val: bool) -> None:
        try:
            if not self._closed:
                self.root.attributes("-topmost", val)
        except Exception:
            pass

    def _set_status(self, msg: str) -> None:
        self.root.after(0, lambda: self.status_var.set(msg))

    def _set_progress(self, frac: float) -> None:
        self._progress = max(0.0, min(1.0, frac))
        val = int(self._progress * 100)

        def apply() -> None:
            try:
                self.bar["value"] = val
            except Exception:
                pass

        self.root.after(0, apply)

    def _set_error(self, msg: str) -> None:
        def apply() -> None:
            self.error_var.set(msg)
            self.retry_btn.configure(state="normal")

        self.root.after(0, apply)

    def _start_worker(self) -> None:
        self.retry_btn.configure(state="disabled")
        self.error_var.set("")
        self._set_progress(0.05)
        self._set_status("Hazırlanıyor…")
        self._worker = threading.Thread(target=self._work, daemon=True)
        self._worker.start()

    def _work(self) -> None:
        try:
            ensure_embed_packages(self._set_status, self._set_progress)
            if not _ui_ready() and not _full_ready():
                raise RuntimeError("Paketler kuruldu ama içe aktarılamadı. logs\\boot.log")
            self._set_status("Uygulama açılıyor…")
            self._set_progress(0.85)
            proc = spawn_main()
            self._set_progress(1.0)
            time.sleep(1.4)
            rc = proc.poll()
            if rc is not None and rc != 0:
                tip = ""
                try:
                    tip = (BOOT_LOG.parent / "main_spawn.log").read_text(
                        encoding="utf-8", errors="replace"
                    )[-500:]
                except Exception:
                    pass
                raise RuntimeError(f"DTA hemen kapandı (kod {rc}).\n{tip}")
            self.root.after(0, self._close)
        except Exception as e:
            _boot_log("ERROR: " + traceback.format_exc())
            self._set_error(str(e))

    def _close(self) -> None:
        self._closed = True
        try:
            self.root.destroy()
        except Exception:
            pass

    def run(self) -> None:
        self.root.mainloop()


def _headless_boot() -> None:
    ensure_embed_packages(lambda s: _boot_log(s), lambda _p: None)
    if not _ui_ready() and not _full_ready():
        raise RuntimeError("DTA paketleri kurulamadı. logs\\boot.log")
    proc = spawn_main()
    time.sleep(1.4)
    rc = proc.poll()
    if rc is not None and rc != 0:
        tip = ""
        try:
            tip = (BOOT_LOG.parent / "main_spawn.log").read_text(
                encoding="utf-8", errors="replace"
            )[-500:]
        except Exception:
            pass
        raise RuntimeError(f"DTA hemen kapandı (kod {rc}).\n{tip}")


def silent_setup() -> int:
    _boot_log("silent-setup")
    try:
        ensure_embed_packages(lambda s: _boot_log(s), lambda _p: None)
        if _ui_ready() or _full_ready():
            _boot_log("silent-setup OK")
            return 0
        _boot_log("silent-setup: paketler doğrulanamadı")
        return 2
    except Exception:
        _boot_log("silent-setup FAIL: " + traceback.format_exc())
        return 1


def main() -> int:
    _dpi_aware()
    _boot_log(f"start cwd={BASE_DIR} exe={sys.executable} argv={sys.argv}")
    if "--silent-setup" in sys.argv:
        return silent_setup()
    try:
        SplashApp().run()
        return 0
    except Exception:
        _boot_log("splash failed, headless: " + traceback.format_exc())
        try:
            _headless_boot()
            return 0
        except Exception:
            _boot_log("FATAL: " + traceback.format_exc())
            _message_box(traceback.format_exc()[-800:])
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
