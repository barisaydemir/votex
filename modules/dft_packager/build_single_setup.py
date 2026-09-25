#!/usr/bin/env python3
"""
Tek Setup.exe üretici — kullanıcıya sadece DFT_Suite_Setup.exe verilir.

Akış (BUILD PC):
  1) fetch_votex_runtimes.py  → Node/Rust/WebView2/VC++
  2) tauri build               → Votex.exe
  3) DTA stage                → runtime + wheels/venv
  4) Inno Setup ISCC          → dist/DFT_Suite_Setup.exe

Kullanım:
  python build_single_setup.py
  python build_single_setup.py --skip-tauri
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

HERE = Path(__file__).resolve().parent
VOTEX = HERE.parent.parent
DTA_SRC = Path(r"D:\surface-z\Surface-z")
STAGING = HERE / "staging"
DIST = HERE / "dist"
# Workspace kökü (C:\votex\target) veya src-tauri/target — hangisi doluysa
_RELEASE_CANDIDATES = (
    VOTEX / "target" / "release",
    VOTEX / "src-tauri" / "target" / "release",
)


def _resolve_release_dir() -> Path:
    for p in _RELEASE_CANDIDATES:
        if (p / "votex.exe").is_file() or (p / "Votex.exe").is_file():
            return p
    # henüz build yoksa workspace varsayılanı
    return _RELEASE_CANDIDATES[0]


RELEASE = _resolve_release_dir()
BUNDLE_NSIS = RELEASE / "bundle" / "nsis"
ISS = HERE / "DFT_Suite.iss"
PACKAGE_VERSION = "0.4.149"

ISCC_CANDIDATES = [
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Inno Setup 6" / "ISCC.exe",
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
    / "Inno Setup 6"
    / "ISCC.exe",
    Path(r"C:\Program Files\Inno Setup 6\ISCC.exe"),
]


def log(msg: str) -> None:
    line = f"[setup] {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)


def find_iscc() -> Path:
    for p in ISCC_CANDIDATES:
        if p.is_file():
            return p
    w = shutil.which("ISCC")
    if w:
        return Path(w)
    raise SystemExit(
        "Inno Setup 6 bulunamadı (ISCC.exe).\n"
        "Kur: https://jrsoftware.org/isdl.php\n"
        "Sonra tekrar: python build_single_setup.py"
    )


def run(cmd: list[str], cwd: Path | None = None) -> None:
    log(" ".join(cmd))
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None)
    if r.returncode != 0:
        raise SystemExit(f"Başarısız ({r.returncode}): {' '.join(cmd)}")


# ── Zorunlu arayüz sağlık kontrolü ──────────────────────────────────────────
# Paketlemeden önce index.html yapı bütünlüğünü doğrular. Kapanmamış bir
# <details>/<div> tüm panelleri yutup arayüzü neredeyse tamamen boşaltabilir
# (0.4.119'da yaşandı); bu kontrol bozuk paketin üretilmesini engeller.
#   1) Tag dengesi: açılan her etiket kapanmalı, yetim </...> olmamalı.
#   2) Panel düzeni sözleşmesi: main.layout doğrudan çocukları sırasıyla
#      #panel-ops · #panel-stage · #panel-intel olmalı.

UI_CHECK_TAGS = (
    "div",
    "details",
    "summary",
    "section",
    "main",
    "label",
    "span",
    "p",
    "button",
)
UI_VOID_TAGS = frozenset(
    "area base br col embed hr img input link meta param source track wbr".split()
)
UI_LAYOUT_MAIN_CLASS = "layout"
UI_LAYOUT_CHILDREN = ("panel-ops", "panel-stage", "panel-intel")


class _UiHtmlProbe(HTMLParser):
    """Yığın tabanlı etiket izleyici + main.layout çocuk kaydı."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int, bool]] = []
        self.errors: list[str] = []
        self.layout_children: list[str] = []
        self.layout_seen = False
        self._layout_depth: int | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in UI_VOID_TAGS:
            return
        line = self.getpos()[0]
        depth = len(self.stack)
        if tag == "main":
            if UI_LAYOUT_MAIN_CLASS in (dict(attrs).get("class") or "").split():
                self.layout_seen = True
                self._layout_depth = depth + 1
        elif self._layout_depth is not None and depth == self._layout_depth:
            attr = dict(attrs)
            self.layout_children.append(attr.get("id") or f"<{tag}>")
        self.stack.append((tag, line, tag in UI_CHECK_TAGS))

    def handle_startendtag(self, tag: str, attrs) -> None:
        pass  # kendini kapatan etiketler yığını etkilemez

    def handle_endtag(self, tag: str) -> None:
        line = self.getpos()[0]
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                for t, ln, tracked in self.stack[i + 1 :]:
                    if tracked:
                        self.errors.append(f"satır {ln}: <{t}> kapanmadan </{tag}> kapandı")
                del self.stack[i:]
                if tag == "main":
                    self._layout_depth = None
                return
        if tag in UI_CHECK_TAGS:
            self.errors.append(f"satır {line}: yetim </{tag}> — açılışı yok")


def ui_health_errors(html: str) -> list[str]:
    """HTML metnindeki yapı hatalarını döndürür; boş liste = sağlıklı."""
    probe = _UiHtmlProbe()
    probe.feed(html)
    probe.close()
    errors = list(probe.errors)
    for tag, line, tracked in probe.stack:
        if tracked:
            errors.append(f"satır {line}: <{tag}> kapanmadan dosya bitti")
    if not probe.layout_seen:
        errors.append("main.layout bulunamadı — panel düzeni sözleşmesi doğrulanamadı")
    elif probe.layout_children != list(UI_LAYOUT_CHILDREN):
        errors.append(
            "panel düzeni sözleşmesi bozuldu — main.layout doğrudan çocukları "
            "beklenen #"
            + " · #".join(UI_LAYOUT_CHILDREN)
            + " · bulunan "
            + (" · ".join(probe.layout_children) or "(yok)")
            + " (bir panel yutulmuş/iç içe geçmiş olabilir)"
        )
    return errors


def ui_health_targets() -> list[Path]:
    targets = [VOTEX / "index.html"]
    dist_html = VOTEX / "dist" / "index.html"
    if dist_html.is_file():
        targets.append(dist_html)
    return targets


def ui_health_check(paths: list[Path] | None = None) -> None:
    """Zorunlu paketleme öncesi kontrol — hata varsa paketleme durur."""
    log("UI sağlık kontrolü (zorunlu): tag dengesi + panel düzeni sözleşmesi")
    failed = False
    for path in paths or ui_health_targets():
        try:
            label = str(path.resolve().relative_to(VOTEX))
        except ValueError:
            label = path.name
        if not path.is_file():
            log(f"  ✗ bulunamadı: {label}")
            failed = True
            continue
        errors = ui_health_errors(path.read_text(encoding="utf-8"))
        if errors:
            failed = True
            for err in errors:
                log(f"  ✗ {label}: {err}")
        else:
            log(f"  ✓ {label}: etiket dengesi + panel düzeni sözleşmesi OK")
    if failed:
        raise SystemExit(
            "Arayüz sağlık kontrolü BAŞARISIZ — paketleme durduruldu. "
            "Kapanmamış/yetim etiketler veya panel düzeni sözleşmesi bozuk; "
            "bozuk arayüzlü kurulum üretilmesi engellendi."
        )


def ensure_runtimes() -> Path:
    rt = HERE / "payload" / "runtimes"
    needed = [
        "node-lts-x64.msi",
        "rustup-init.exe",
        "MicrosoftEdgeWebView2RuntimeInstallerX64.exe",
        "VC_redist.x64.exe",
    ]
    missing = [n for n in needed if not (rt / n).is_file()]
    if missing:
        log("Eksik runtime — indiriliyor…")
        run([sys.executable, str(HERE / "fetch_votex_runtimes.py")])
        missing = [n for n in needed if not (rt / n).is_file()]
    if missing:
        raise SystemExit(
            "Runtime dosyaları eksik: "
            + ", ".join(missing)
            + f"\nKlasör: {rt}"
        )
    # settings writer for Inno [Run]
    ps = rt / "write_settings.ps1"
    ps.write_text(
        r"""
$votexSettings = Join-Path $env:APPDATA "Votex"
New-Item -ItemType Directory -Force -Path $votexSettings | Out-Null
$dta = Join-Path $env:ProgramFiles "DerinTaramaAsistan\launcher.py"
@{
  dtaLaunchPath = $dta
  autoLaunchDta = $true
} | ConvertTo-Json | Set-Content (Join-Path $votexSettings "settings.json") -Encoding UTF8
$dft = Join-Path $env:APPDATA "DFT"
New-Item -ItemType Directory -Force -Path $dft | Out-Null
""",
        encoding="utf-8",
    )
    return rt


def build_tauri() -> None:
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("npm yok — build PC'de Node gerekli")
    run([npm, "run", "build:installer"], cwd=VOTEX)


def stage_votex(staging_votex: Path) -> Path | None:
    staging_votex.mkdir(parents=True, exist_ok=True)
    release = _resolve_release_dir()
    log(f"Release: {release}")
    exe = None
    for name in ("votex.exe", "Votex.exe"):
        p = release / name
        if p.is_file():
            exe = p
            break
    if not exe:
        raise SystemExit(f"Votex.exe yok: {release} — önce tauri build")
    shutil.copy2(exe, staging_votex / "Votex.exe")
    # UI assets for some builds
    for name in ("resources",):
        src = release / name
        if src.is_dir():
            dst = staging_votex / name
            if dst.exists():
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
    # VOTEX tek kez, doğrudan Inno Setup içindeki staging\VOTEX yolundan kurulur.
    # Tauri'nin nested NSIS paketini eklemek aynı klasöre iki installer'ın
    # müdahale etmesine ve eski kaldırıcı hatalarının kurulumu durdurmasına yol açabilir.
    return None


def stage_dta(dest: Path) -> None:
    # reuse prepare_installer.stage_dta logic via import
    sys.path.insert(0, str(HERE))
    from prepare_installer import stage_dta as _stage

    _stage(dest)


ARTEMIS_ISS = HERE / "VotexArtemis.iss"
ARTEMIS_STAGING = HERE / "staging_artemis"


def write_artemis_info() -> None:
    """VotexArtemis ayrı kurulum bilgilendirme metni."""
    (ARTEMIS_STAGING / "INFO_BEFORE.txt").write_text(
        f"""VotexArtemis kurulumu (sürüm {PACKAGE_VERSION})

VotexArtemis AYRI BİR PROGRAMDIR:
  • {chr(123)}autopf{chr(125)}\\VotexArtemis klasörüne kurulur; mevcut
    DFT Suite / VOTEX / Derin Tarama Asistan kurulumlarına DOKUNMAZ.
  • Eski kurulum kaldırılmaz; süreçler kapatılmaz.
  • Kullanıcı verileri %APPDATA%\\VotexArtemis altında ayrı tutulur.
  • Gerekli çalışma zamanları (VC++ / WebView2 / Node / Rust) sistemde
    yoksa sessiz kurulur; varsa atlanır.

Kurulum yönetici izni ister ve birkaç dakika sürebilir.
Kısayol: masaüstü ve Başlat menüsü → VotexArtemis.
""",
        encoding="utf-8",
    )


def build_artemis_setup(args) -> int:
    """VotexArtemis — ayrı program kurulumu üret.

    DFT Suite akışından farkları:
    - Yalnız votex.exe + resources stage edilir (DTA yok).
    - VotexArtemis.exe olarak adlandırılır.
    - VotexArtemis.iss derlenir: ayrı AppId, {autopf}\\VotexArtemis
      klasörü, eski kurulumlara dokunmayan [Code] bölümü.
    - Çıktı: dist/VotexArtemis_Setup_<sürüm>.exe + KURULUM_PAKETLERI.
    """
    # Zorunlu: paketleme başlamadan arayüz sağlık kontrolü (aynı sözleşme)
    ui_health_check()

    iscc = find_iscc()
    log(f"ISCC: {iscc}")

    DIST.mkdir(parents=True, exist_ok=True)

    if ARTEMIS_STAGING.exists():
        shutil.rmtree(ARTEMIS_STAGING)
    ARTEMIS_STAGING.mkdir(parents=True)

    rt = HERE / "payload" / "runtimes"
    if not (rt / "VC_redist.x64.exe").is_file():
        log("Runtime dosyaları eksik — indiriliyor…")
        run([sys.executable, str(HERE / "fetch_votex_runtimes.py")])
    shutil.copytree(rt, ARTEMIS_STAGING / "runtimes")

    if not args.skip_tauri:
        log("Tauri NSIS / release build…")
        build_tauri()
    else:
        log("Tauri build atlandı (--skip-tauri)")

    app_stage = ARTEMIS_STAGING / "VotexArtemis"
    stage_votex(app_stage)
    # Ayrı program kimliği: exe adını değiştir (Tauri votex.exe üretir)
    src_exe = app_stage / "Votex.exe"
    if src_exe.is_file():
        shutil.move(str(src_exe), str(app_stage / "VotexArtemis.exe"))
        log("Votex.exe -> VotexArtemis.exe olarak adlandırıldı")
    else:
        raise SystemExit("staging Votex.exe yok — tauri build çıktısı eksik")

    write_artemis_info()

    log("Inno Setup derleniyor -> VotexArtemis_Setup.exe...")
    run([str(iscc), str(ARTEMIS_ISS)], cwd=HERE)

    out = DIST / f"VotexArtemis_Setup_{PACKAGE_VERSION}.exe"
    if not out.is_file():
        cands = sorted(
            DIST.glob("VotexArtemis_Setup*.exe"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not cands:
            raise SystemExit(f"VotexArtemis setup üretilemedi: {DIST}")
        out = cands[0]

    sha256 = hashlib.sha256()
    with out.open("rb") as setup_file:
        for chunk in iter(lambda: setup_file.read(1024 * 1024), b""):
            sha256.update(chunk)

    meta = {
        "created": datetime.now().isoformat(timespec="seconds"),
        "version": PACKAGE_VERSION,
        "output": str(out),
        "size_bytes": out.stat().st_size,
        "size_mb": round(out.stat().st_size / (1024 * 1024), 1),
        "sha256": sha256.hexdigest(),
        "package": "votex-artemis",
        "standalone_program": True,
        "touch_dft_suite": False,
        "user_action": f"Sadece VotexArtemis_Setup_{PACKAGE_VERSION}.exe çalıştır",
        "notes": [
            f"VotexArtemis {PACKAGE_VERSION} — DFT Suite'ten bağımsız ayrı program",
            "Kurulum: {autopf}\\VotexArtemis · veriler: %APPDATA%\\VotexArtemis",
            "Runtime'lar koşullu kurulur; mevcut sistem bileşenleri korunur",
        ],
    }
    (DIST / "votex_artemis_setup_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    kurulum = VOTEX / "KURULUM_PAKETLERI"
    kurulum.mkdir(parents=True, exist_ok=True)
    dest = kurulum / f"VotexArtemis_{PACKAGE_VERSION}_Kurulum.exe"
    shutil.copy2(out, dest)
    log(f"KURULUM_PAKETLERI: {dest}")
    log(f"TAMAM: {out} ({meta['size_mb']} MB)")
    log("Kullanıcıya sadece bu dosyayı verin.")
    return 0


def write_info() -> None:
    (STAGING / "INFO_BEFORE.txt").write_text(
        """DFT Suite kurulumu

Bu tek paket şunları kurar:
  • VOTEX (Tauri) + Node.js + Rust + WebView2 + VC++
  • Derin Tarama Asistan (DTA, Python)

Kurulum yönetici izni ister ve birkaç dakika sürebilir.
Mevcut VOTEX/DFT Suite kurulumu otomatik kaldırılır, sonra bu sürüm kurulur.
Kullanıcı arşivleri ve %APPDATA% ayarları korunur.
İnternet: Rust/Node MSI yerelde; WebView2 offline paket varsa internet gerekmez.

VOTEX ve DTA ayrı programlardır; kısayollar masaüstüne eklenir.
""",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Tek DFT_Suite_Setup.exe üret")
    ap.add_argument("--skip-tauri", action="store_true")
    ap.add_argument("--skip-fetch", action="store_true")
    ap.add_argument(
        "--artemis",
        action="store_true",
        help="ayrı program modu: VotexArtemis_Setup üret (DFT Suite'e dokunmayan bağımsız kurulum)",
    )
    ap.add_argument(
        "--keep-staging",
        action="store_true",
        help="staging silinmez; VoteX'e dokunulmaz, sadece mevcut DTA+VOTEX ile Setup derlenir",
    )
    ap.add_argument(
        "--check-ui",
        nargs="*",
        metavar="HTML",
        help="yalnız arayüz sağlık kontrolünü çalıştır (varsayılan: index.html + dist/index.html)",
    )
    args = ap.parse_args()
    if args.artemis:
        return build_artemis_setup(args)

    if args.check_ui is not None:
        ui_health_check([Path(p) for p in args.check_ui] or None)
        return 0

    # Zorunlu: paketleme başlamadan arayüz sağlık kontrolü
    ui_health_check()

    iscc = find_iscc()
    log(f"ISCC: {iscc}")

    DIST.mkdir(parents=True, exist_ok=True)

    if args.keep_staging:
        if not (STAGING / "DTA" / "launcher.py").is_file():
            raise SystemExit("staging\\DTA yok — önce --repair-staging-dta veya tam stage")
        log("staging korundu (VoteX yeniden kopyalanmadı)")
        write_info()
    else:
        if STAGING.exists():
            shutil.rmtree(STAGING)
        STAGING.mkdir(parents=True)

        if not args.skip_fetch:
            ensure_runtimes()
        else:
            ensure_runtimes()  # still validates

        if not args.skip_tauri:
            log("Tauri NSIS / release build…")
            build_tauri()
        else:
            log("Tauri build atlandı")

        rt = HERE / "payload" / "runtimes"
        shutil.copytree(rt, STAGING / "runtimes")
        stage_votex(STAGING / "VOTEX")
        stage_dta(STAGING / "DTA")
        # DTA yorum kılavuzu (schema/VOTEX_EKRAN.md) pakete girsin —
        # stage_dta yalnız actions/core/memory/config klasörlerini kopyalar.
        try:
            schema_src = DTA_SRC / "schema"
            if schema_src.is_dir():
                shutil.copytree(schema_src, STAGING / "DTA" / "schema", ignore=shutil.ignore_patterns("__pycache__"))
                log("DTA schema/ staged")
        except Exception as exc:
            log(f"schema stage atlandı: {exc}")
        write_info()

    # Inno OutputDir relative to iss location
    log("Inno Setup derleniyor -> tek Setup.exe...")
    run([str(iscc), str(ISS)], cwd=HERE)

    out = DIST / f"DFT_Suite_Setup_{PACKAGE_VERSION}.exe"
    if not out.is_file():
        # sometimes unversioned or alternate name
        cands = sorted(
            DIST.glob("DFT_Suite_Setup*.exe"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not cands:
            raise SystemExit(f"Setup üretilemedi: {DIST}")
        out = cands[0]

    sha256 = hashlib.sha256()
    with out.open("rb") as setup_file:
        for chunk in iter(lambda: setup_file.read(1024 * 1024), b""):
            sha256.update(chunk)

    meta = {
        "created": datetime.now().isoformat(timespec="seconds"),
        "version": PACKAGE_VERSION,
        "output": str(out),
        "size_bytes": out.stat().st_size,
        "size_mb": round(out.stat().st_size / (1024 * 1024), 1),
        "sha256": sha256.hexdigest(),
        "votex_install_mode": "direct-staging",
        "nested_tauri_setup": False,
        "user_action": f"Sadece DFT_Suite_Setup_{PACKAGE_VERSION}.exe çalıştır",
        "notes": [
            "Legacy3DMag dik çekim → anomali / olası yapı şekilleri",
            "DTA: PyAudio timeout + yazı-modu, Live 2.5 native-audio",
            f"VOTEX {PACKAGE_VERSION} + Derin Tarama Asistan",
        ],
    }
    (DIST / "setup_meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    kurulum = VOTEX / "KURULUM_PAKETLERI"
    kurulum.mkdir(parents=True, exist_ok=True)
    dest = kurulum / f"Votex_{PACKAGE_VERSION}_Kurulum.exe"
    shutil.copy2(out, dest)
    log(f"KURULUM_PAKETLERI: {dest}")
    log(f"TAMAM: {out} ({meta['size_mb']} MB)")
    log("Kullanıcıya sadece bu dosyayı verin.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
