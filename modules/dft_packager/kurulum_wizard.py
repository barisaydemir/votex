"""DFT Suite — anahtar teslim kurulum sihirbazı (Tk)."""

from __future__ import annotations

import os
import sys
import threading
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

from detect import load_manifest, scan
from install_prereqs import copy_apps, install_missing

# Lisans (opsiyonel)
try:
    from dft_license.gate import activate_license_token
    from dft_license.hwid import get_hwid_short
except Exception:
    activate_license_token = None  # type: ignore
    get_hwid_short = lambda: "—"  # type: ignore


def dft_log_path() -> Path:
    base = Path(os.environ.get("APPDATA", ".")) / "DFT"
    base.mkdir(parents=True, exist_ok=True)
    return base / "install.log"


class KurulumApp:
    def __init__(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.root = tk.Tk()
        self.root.title("DFT Suite Kurulum")
        self.root.geometry("520x420")
        self.root.configure(bg="#020617")
        self.status = tk.StringVar(value="Hazır — Kuruluma başlayın")
        self.token = tk.StringVar(value="")
        self._busy = False

        frm = tk.Frame(self.root, bg="#020617", padx=24, pady=20)
        frm.pack(fill="both", expand=True)

        tk.Label(
            frm,
            text="DFT Suite",
            font=("Segoe UI Semibold", 18),
            fg="#bfdbfe",
            bg="#020617",
        ).pack(anchor="w")
        tk.Label(
            frm,
            text="VOTEX + Derin Tarama Asistan — anahtar teslim kurulum",
            font=("Segoe UI", 9),
            fg="#64748b",
            bg="#020617",
        ).pack(anchor="w", pady=(4, 16))

        tk.Label(
            frm,
            text=f"Cihaz ID: {get_hwid_short()}",
            font=("Segoe UI", 9),
            fg="#60a5fa",
            bg="#020617",
        ).pack(anchor="w")

        self.status_lbl = tk.Label(
            frm,
            textvariable=self.status,
            font=("Segoe UI", 11),
            fg="#3b82f6",
            bg="#020617",
            wraplength=460,
            justify="left",
            anchor="w",
        )
        self.status_lbl.pack(fill="x", pady=(16, 8))

        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except Exception:
            pass
        self.bar = ttk.Progressbar(frm, mode="determinate", maximum=100, length=460)
        self.bar.pack(pady=8, anchor="w")

        tk.Label(
            frm,
            text="Lisans kodu (isteğe bağlı — sonra da girilebilir)",
            fg="#64748b",
            bg="#020617",
            font=("Segoe UI", 9),
        ).pack(anchor="w", pady=(8, 0))
        tk.Entry(frm, textvariable=self.token, width=64).pack(fill="x", pady=4)

        row = tk.Frame(frm, bg="#020617")
        row.pack(fill="x", pady=16)
        self.btn = tk.Button(
            row,
            text="Kuruluma başla",
            command=self._start,
            bg="#1e3a8a",
            fg="#bfdbfe",
            relief="flat",
            padx=14,
            pady=8,
            font=("Segoe UI", 10),
        )
        self.btn.pack(side="left")
        tk.Button(
            row,
            text="Kapat",
            command=self.root.destroy,
            bg="#0b1120",
            fg="#bfdbfe",
            relief="flat",
            padx=14,
            pady=8,
        ).pack(side="right")

    def _set(self, text: str, prog: float | None = None) -> None:
        def apply() -> None:
            self.status.set(text)
            if prog is not None:
                self.bar["value"] = max(0, min(100, int(prog * 100)))

        self.root.after(0, apply)
        try:
            with dft_log_path().open("a", encoding="utf-8") as f:
                f.write(text + "\n")
        except Exception:
            pass

    def _start(self) -> None:
        if self._busy:
            return
        self._busy = True
        self.btn.configure(state="disabled")
        threading.Thread(target=self._work, daemon=True).start()

    def _work(self) -> None:
        try:
            payload = HERE / "payload"
            manifest = load_manifest()
            self._set("Sistem taranıyor…", 0.05)
            report = scan(payload, manifest)
            if not report.get("arch_ok", True):
                self._set("Bu kurulum 64-bit Windows gerektirir.", 0)
                return
            if not report.get("disk_ok", True):
                self._set("Yetersiz disk alanı.", 0)
                return

            self._set("Gerekli bileşenler kuruluyor…", 0.15)
            results = install_missing(payload, log=lambda m: self._set(m, 0.4))
            failed = [r for r in results if not r[1]]
            if failed:
                self._set(
                    "Bazı bileşenler kurulamadı (payload eksik olabilir). Log: "
                    + str(dft_log_path()),
                    0.5,
                )
                # Yine de uygulamaları kopyalamayı dene

            self._set("Uygulamalar kopyalanıyor…", 0.7)
            copy_apps(payload, manifest, log=lambda m: self._set(m, 0.8))

            tok = self.token.get().strip()
            if tok and activate_license_token:
                ok, msg = activate_license_token(tok)
                self._set(("Lisans: " + msg) if ok else ("Lisans hatası: " + msg), 0.9)

            self._set(
                "Kurulum tamam. VOTEX ve DTA Programs klasöründe. Log: "
                + str(dft_log_path()),
                1.0,
            )
        except Exception as e:
            self._set(f"Hata: {e}\n{traceback.format_exc()[:300]}", 0)
        finally:
            self._busy = False
            self.root.after(0, lambda: self.btn.configure(state="normal"))

    def run(self) -> None:
        self.root.mainloop()


def main() -> int:
    KurulumApp().run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
