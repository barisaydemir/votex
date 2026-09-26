from __future__ import annotations

import ctypes
import ctypes.wintypes
import os
import shutil
import subprocess
import tempfile
import time
import webbrowser
from pathlib import Path


IS_WINDOWS = os.name == "nt"


def open_url(url: str) -> None:
    webbrowser.open(url, new=2)


def copy_to_clipboard(text: str) -> tuple[bool, str]:
    try:
        subprocess.run(["clip"], input=text, text=True, check=True, timeout=5)
        return True, "ok"
    except Exception as exc:
        return False, f"Panoya kopyalanamadi: {exc}"


def _run_powershell(script: str, timeout: int = 20) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def open_windows_app(app_name: str) -> tuple[bool, str]:
    normalized = (app_name or "").strip()
    if not normalized:
        return False, "Uygulama adi belirtilmedi."

    aliases = {
        "chrome": "chrome",
        "google chrome": "chrome",
        "edge": "msedge",
        "microsoft edge": "msedge",
        "firefox": "firefox",
        "terminal": "wt",
        "windows terminal": "wt",
        "cmd": "cmd",
        "powershell": "powershell",
        "explorer": "explorer",
        "dosya gezgini": "explorer",
        "notepad": "notepad",
        "not defteri": "notepad",
        "calculator": "calc",
        "hesap makinesi": "calc",
        "spotify": "spotify",
        "whatsapp": "WhatsApp",
        "vscode": "code",
        "vs code": "code",
        "visual studio code": "code",
    }
    target = aliases.get(normalized.lower(), normalized)

    try:
        if shutil.which(target):
            subprocess.Popen([target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True, f"{normalized} acildi."
        escaped = target.replace("'", "''")
        result = _run_powershell(f"Start-Process '{escaped}'", timeout=10)
        if result.returncode == 0:
            return True, f"{normalized} acildi."
        detail = (result.stderr or result.stdout or "").strip()
        return False, detail or f"'{normalized}' bulunamadi veya acilamadi."
    except Exception as exc:
        return False, f"'{normalized}' acilamadi: {exc}"


def open_uri(uri: str) -> tuple[bool, str]:
    try:
        os.startfile(uri)  # type: ignore[attr-defined]
        return True, "ok"
    except Exception as exc:
        return False, str(exc)


def press_enter_after_delay(delay: float) -> tuple[bool, str]:
    try:
        time.sleep(max(0.0, delay))
        import pyautogui  # type: ignore

        pyautogui.press("enter")
        return True, "ok"
    except Exception as exc:
        return False, f"Otomatik tus basimi tamamlanamadi: {exc}"


def hotkey(*keys: str, delay: float = 0.0) -> tuple[bool, str]:
    try:
        if delay > 0:
            time.sleep(delay)
        import pyautogui  # type: ignore

        pyautogui.hotkey(*keys)
        return True, "ok"
    except Exception as exc:
        return False, f"Klavye otomasyonu tamamlanamadi: {exc}"


def write_text(text: str, delay: float = 0.0) -> tuple[bool, str]:
    try:
        if delay > 0:
            time.sleep(delay)
        import pyautogui  # type: ignore

        pyautogui.write(text)
        return True, "ok"
    except Exception as exc:
        return False, f"Yazi yazma otomasyonu tamamlanamadi: {exc}"


def speak_with_windows(text: str, voice: str = "") -> tuple[bool, str]:
    escaped_text = text.replace("'", "''")
    escaped_voice = voice.replace("'", "''")
    select_voice = (
        f"$v = $s.GetInstalledVoices() | Where-Object {{ $_.VoiceInfo.Name -like '*{escaped_voice}*' }} | Select-Object -First 1; "
        "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; "
        if escaped_voice
        else ""
    )
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        f"{select_voice}"
        f"$s.Speak('{escaped_text}');"
    )
    try:
        result = _run_powershell(script, timeout=60)
        if result.returncode == 0:
            return True, "ok"
        return False, (result.stderr or result.stdout or "").strip()
    except Exception as exc:
        return False, str(exc)


def list_windows_voices() -> list[str]:
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }"
    )
    try:
        result = _run_powershell(script, timeout=10)
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]
    except Exception:
        return []


def play_audio_file(path: Path, volume: float = 0.2) -> subprocess.Popen:
    safe_path = str(path).replace("'", "''")
    vol = max(0.0, min(1.0, float(volume)))
    script = (
        "Add-Type -AssemblyName PresentationCore; "
        "$p = New-Object System.Windows.Media.MediaPlayer; "
        f"$p.Open([Uri]::new('{safe_path}')); "
        f"$p.Volume = {vol}; "
        "$p.Play(); "
        "Start-Sleep -Milliseconds 300; "
        "while ($p.NaturalDuration.HasTimeSpan -and $p.Position -lt $p.NaturalDuration.TimeSpan) "
        "{ Start-Sleep -Milliseconds 120 }; "
        "$p.Close();"
    )
    return subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW
    )


_DPI_AWARE = False


def _ensure_dpi_aware() -> None:
    """ElitePad DPI: GetWindowRect mantiksal kalirsa yakalama kesilir."""
    global _DPI_AWARE
    if _DPI_AWARE:
        return
    try:
        # 2 = PROCESS_PER_MONITOR_DPI_AWARE
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        _DPI_AWARE = True
        return
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDPIAware()
        _DPI_AWARE = True
    except Exception:
        _DPI_AWARE = True  # tekrar deneme


def get_window_hwnd_and_title(target: str = "active_window") -> tuple[int, str, str]:
    if not IS_WINDOWS:
        return 0, "", ""
    _ensure_dpi_aware()
    user32 = ctypes.windll.user32
    GA_ROOT = 2

    if target == "active_window":
        hwnd = user32.GetForegroundWindow()
        length = user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        return hwnd, "", buffer.value.strip()

    # İlk eşleşmeyi alma — ELIC bazen küçük child pencere döndürüyor.
    # En büyük kök pencereyi seç.
    matches: list[tuple[int, str, int]] = []  # hwnd, title, area

    def foreach_window(hwnd, lParam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        title = buff.value.strip()
        if target.lower() not in title.lower():
            return True
        try:
            root = int(user32.GetAncestor(hwnd, GA_ROOT) or hwnd)
        except Exception:
            root = int(hwnd)
        rect = ctypes.wintypes.RECT()
        if not user32.GetWindowRect(root, ctypes.byref(rect)):
            return True
        area = max(0, int(rect.right - rect.left)) * max(0, int(rect.bottom - rect.top))
        if area < 100 * 100:
            return True
        matches.append((root, title, area))
        return True

    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    user32.EnumWindows(EnumWindowsProc(foreach_window), 0)
    if not matches:
        return 0, "", ""
    # Tam başlık eşleşmesi tercih; sonra en büyük alan
    exact = [m for m in matches if m[1].lower() == target.lower()]
    pool = exact or matches
    best = max(pool, key=lambda m: m[2])
    return best[0], "", best[1]


def find_window_visible(*title_parts: str) -> tuple[bool, str]:
    """Baslikta herhangi bir parca geciyorsa (True, title). Coklu monitör OK."""
    for part in title_parts:
        p = (part or "").strip()
        if not p:
            continue
        hwnd, _, title = get_window_hwnd_and_title(p)
        if hwnd and title:
            return True, title
    return False, ""


def _enum_primary_pels() -> tuple[int, int]:
    """Birincil ekranın fiziksel cozunurlugu (DPI'dan bagimsiz). Ornek: 1920x1200."""
    user32 = ctypes.windll.user32
    ENUM_CURRENT_SETTINGS = -1

    class DEVMODEW(ctypes.Structure):
        _fields_ = [
            ("dmDeviceName", ctypes.c_wchar * 32),
            ("dmSpecVersion", ctypes.wintypes.WORD),
            ("dmDriverVersion", ctypes.wintypes.WORD),
            ("dmSize", ctypes.wintypes.WORD),
            ("dmDriverExtra", ctypes.wintypes.WORD),
            ("dmFields", ctypes.wintypes.DWORD),
            ("dmPositionX", ctypes.c_long),
            ("dmPositionY", ctypes.c_long),
            ("dmDisplayOrientation", ctypes.wintypes.DWORD),
            ("dmDisplayFixedOutput", ctypes.wintypes.DWORD),
            ("dmColor", ctypes.wintypes.SHORT),
            ("dmDuplex", ctypes.wintypes.SHORT),
            ("dmYResolution", ctypes.wintypes.SHORT),
            ("dmTTOption", ctypes.wintypes.SHORT),
            ("dmCollate", ctypes.wintypes.SHORT),
            ("dmFormName", ctypes.c_wchar * 32),
            ("dmLogPixels", ctypes.wintypes.WORD),
            ("dmBitsPerPel", ctypes.wintypes.DWORD),
            ("dmPelsWidth", ctypes.wintypes.DWORD),
            ("dmPelsHeight", ctypes.wintypes.DWORD),
            ("dmDisplayFlags", ctypes.wintypes.DWORD),
            ("dmDisplayFrequency", ctypes.wintypes.DWORD),
            ("dmICMMethod", ctypes.wintypes.DWORD),
            ("dmICMIntent", ctypes.wintypes.DWORD),
            ("dmMediaType", ctypes.wintypes.DWORD),
            ("dmDitherType", ctypes.wintypes.DWORD),
            ("dmReserved1", ctypes.wintypes.DWORD),
            ("dmReserved2", ctypes.wintypes.DWORD),
            ("dmPanningWidth", ctypes.wintypes.DWORD),
            ("dmPanningHeight", ctypes.wintypes.DWORD),
        ]

    dm = DEVMODEW()
    dm.dmSize = ctypes.sizeof(DEVMODEW)
    if not user32.EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, ctypes.byref(dm)):
        return 0, 0
    w, h = int(dm.dmPelsWidth), int(dm.dmPelsHeight)
    if w < 64 or h < 64:
        return 0, 0
    return w, h


def _virtual_screen_rect() -> tuple[int, int, int, int]:
    """
    Tam ekran dikdortgeni — fiziksel piksel.
    DPI unaware iken GetSystemMetrics 1280x800 verebilir; asıl 1920x1200 olmali.
    """
    _ensure_dpi_aware()
    user32 = ctypes.windll.user32
    phys_w, phys_h = _enum_primary_pels()

    left = int(user32.GetSystemMetrics(76))  # SM_XVIRTUALSCREEN
    top = int(user32.GetSystemMetrics(77))
    width = int(user32.GetSystemMetrics(78))
    height = int(user32.GetSystemMetrics(79))
    if width < 64 or height < 64:
        width = int(user32.GetSystemMetrics(0))
        height = int(user32.GetSystemMetrics(1))
        left, top = 0, 0

    # DPI kirpmasi: metrics fizikselden ~%10+ kucukse fiziksel kullan
    if phys_w and phys_h and (width < int(phys_w * 0.92) or height < int(phys_h * 0.92)):
        _log_capture(
            f"DPI resize duzeltmesi: metrics={width}x{height} -> physical={phys_w}x{phys_h}"
        )
        return 0, 0, phys_w, phys_h

    # Tek monitörde metrics zaten iyiyse onu kullan (negatif origin olabilir)
    if phys_w and phys_h and width >= phys_w * 0.92 and height >= phys_h * 0.92:
        return left, top, left + width, top + height

    if phys_w and phys_h:
        return 0, 0, phys_w, phys_h

    return left, top, left + width, top + height


def raise_window_topmost(target: str, steal_focus: bool = False) -> bool:
    """Pencereyi uste getir; tablet DTA'nin ELIC altinda kalmamasi icin."""
    if not IS_WINDOWS or not target:
        return False
    hwnd, _, _ = get_window_hwnd_and_title(target)
    if not hwnd:
        return False
    user32 = ctypes.windll.user32
    HWND_TOPMOST = -1
    SWP_NOMOVE = 0x0002
    SWP_NOSIZE = 0x0001
    SWP_SHOWWINDOW = 0x0040
    SW_RESTORE = 9
    try:
        user32.ShowWindow(hwnd, SW_RESTORE)
        user32.SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        )
        if steal_focus:
            user32.SetForegroundWindow(hwnd)
        return True
    except Exception:
        return False


def _window_rect(hwnd: int) -> tuple[int, int, int, int] | None:
    """Pencere dikdortgeni — birden fazla kaynaktan en genisini sec (DPI kirpmaya karsi)."""
    _ensure_dpi_aware()
    user32 = ctypes.windll.user32
    candidates: list[tuple[int, int, int, int]] = []

    def _add(rect) -> None:
        try:
            left, top, right, bottom = int(rect[0]), int(rect[1]), int(rect[2]), int(rect[3])
            if right - left >= 64 and bottom - top >= 64:
                candidates.append((left, top, right, bottom))
        except Exception:
            pass

    rect = ctypes.wintypes.RECT()
    # 1) DWM gercek cerceve
    try:
        hr = ctypes.windll.dwmapi.DwmGetWindowAttribute(
            hwnd, 9, ctypes.byref(rect), ctypes.sizeof(rect)
        )
        if hr == 0:
            _add((rect.left, rect.top, rect.right, rect.bottom))
    except Exception:
        pass

    # 2) GetWindowRect
    if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        _add((rect.left, rect.top, rect.right, rect.bottom))

    # 3) Client alani ekran koordinatina
    try:
        client = ctypes.wintypes.RECT()
        if user32.GetClientRect(hwnd, ctypes.byref(client)):
            pt1 = ctypes.wintypes.POINT(0, 0)
            pt2 = ctypes.wintypes.POINT(client.right, client.bottom)
            user32.ClientToScreen(hwnd, ctypes.byref(pt1))
            user32.ClientToScreen(hwnd, ctypes.byref(pt2))
            _add((pt1.x, pt1.y, pt2.x, pt2.y))
    except Exception:
        pass

    if not candidates:
        return None
    # En genis alan = en az kirpik
    return max(candidates, key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))


def _monitor_rect_for_hwnd(hwnd: int) -> tuple[int, int, int, int] | None:
    """ELIC'in oldugu monitörün tamamı (2. referans resim gibi)."""
    _ensure_dpi_aware()
    user32 = ctypes.windll.user32

    class MONITORINFO(ctypes.Structure):
        _fields_ = [
            ("cbSize", ctypes.wintypes.DWORD),
            ("rcMonitor", ctypes.wintypes.RECT),
            ("rcWork", ctypes.wintypes.RECT),
            ("dwFlags", ctypes.wintypes.DWORD),
        ]

    try:
        hmon = user32.MonitorFromWindow(hwnd, 2)  # MONITOR_DEFAULTTONEAREST
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        if not user32.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            return None
        r = mi.rcMonitor
        left, top, right, bottom = int(r.left), int(r.top), int(r.right), int(r.bottom)
        if right - left < 64 or bottom - top < 64:
            return None
        return left, top, right, bottom
    except Exception:
        return None


def _bitmap_to_image(hdc, bmp, width: int, height: int):
    from PIL import Image

    gdi32 = ctypes.windll.gdi32

    class BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [
            ("biSize", ctypes.wintypes.DWORD),
            ("biWidth", ctypes.c_long),
            ("biHeight", ctypes.c_long),
            ("biPlanes", ctypes.wintypes.WORD),
            ("biBitCount", ctypes.wintypes.WORD),
            ("biCompression", ctypes.wintypes.DWORD),
            ("biSizeImage", ctypes.wintypes.DWORD),
            ("biXPelsPerMeter", ctypes.c_long),
            ("biYPelsPerMeter", ctypes.c_long),
            ("biClrUsed", ctypes.wintypes.DWORD),
            ("biClrImportant", ctypes.wintypes.DWORD),
        ]

    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth = width
    bmi.biHeight = -height
    bmi.biPlanes = 1
    bmi.biBitCount = 32
    bmi.biCompression = 0
    buf_len = width * height * 4
    buf = (ctypes.c_char * buf_len)()
    got = gdi32.GetDIBits(hdc, bmp, 0, height, buf, ctypes.byref(bmi), 0)
    if not got:
        return None
    return Image.frombuffer("RGB", (width, height), bytes(buf), "raw", "BGRX", 0, 1).copy()


def _capture_screen_rect(bounds: tuple[int, int, int, int]):
    """Ekran dikdortgenini BitBlt ile al (DirectX/ELIC icin PrintWindow'dan guvenilir)."""
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top
    if width < 8 or height < 8:
        return None

    screen_dc = user32.GetDC(0)
    if not screen_dc:
        return None
    mem_dc = gdi32.CreateCompatibleDC(screen_dc)
    bmp = gdi32.CreateCompatibleBitmap(screen_dc, width, height)
    old = gdi32.SelectObject(mem_dc, bmp)
    SRCCOPY = 0x00CC0020
    ok = gdi32.BitBlt(mem_dc, 0, 0, width, height, screen_dc, left, top, SRCCOPY)
    image = _bitmap_to_image(mem_dc, bmp, width, height) if ok else None
    gdi32.SelectObject(mem_dc, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(0, screen_dc)
    return image


def _capture_hwnd_printwindow(hwnd: int):
    """Yedek: PrintWindow (Atom/DPI'da kirpabiliyor — son care)."""
    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    bounds = _window_rect(hwnd)
    if not bounds:
        return None
    left, top, right, bottom = bounds
    width = right - left
    height = bottom - top

    hwnd_dc = user32.GetWindowDC(hwnd)
    if not hwnd_dc:
        return None
    mem_dc = gdi32.CreateCompatibleDC(hwnd_dc)
    bmp = gdi32.CreateCompatibleBitmap(hwnd_dc, width, height)
    old = gdi32.SelectObject(mem_dc, bmp)
    ok = user32.PrintWindow(hwnd, mem_dc, 2) or user32.PrintWindow(hwnd, mem_dc, 0)
    image = _bitmap_to_image(mem_dc, bmp, width, height) if ok else None
    gdi32.SelectObject(mem_dc, old)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mem_dc)
    user32.ReleaseDC(hwnd, hwnd_dc)
    return image


def _log_capture(msg: str) -> None:
    try:
        log = Path(__file__).resolve().parent.parent / "logs" / "capture.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")
    except Exception:
        pass


def capture_window(target: str = "active_window", output_path: Path | None = None) -> tuple[bool, str, dict]:
    """
    ELIC analizi icin TAM ekran kadraji.
    Once sanal masaustu / birincil ekranin tamamı — pencere rect ile kirpma YOK.
    """
    try:
        from PIL import ImageGrab

        _ensure_dpi_aware()
        hwnd, owner_name, window_title = get_window_hwnd_and_title(target)

        if target != "active_window" and not hwnd:
            return False, f"'{target}' isimli pencere bulunamadi.", {}

        image = None
        method = ""
        used_bounds: tuple[int, int, int, int] | None = None

        # 1) Her zaman tam ekran (referans Snipping Tool resmi gibi)
        full = _virtual_screen_rect()
        for name, grabber in (
            ("virtual_bitblt", lambda b: _capture_screen_rect(b)),
            ("virtual_imagegrab", lambda b: ImageGrab.grab(bbox=b, all_screens=True)),
        ):
            try:
                image = grabber(full)
                if image is not None and min(image.size) >= 64:
                    method = name
                    used_bounds = full
                    break
                image = None
            except Exception as exc:
                _log_capture(f"{name} fail: {exc}")
                image = None

        # 2) ImageGrab tüm ekranlar (bbox yok)
        if image is None:
            try:
                image = ImageGrab.grab(all_screens=True)
                method = "imagegrab_allscreens"
                used_bounds = (0, 0, image.size[0], image.size[1])
            except Exception as exc:
                _log_capture(f"imagegrab_all fail: {exc}")
                image = None

        # 3) Son çare: monitör / pencere
        if image is None and IS_WINDOWS and hwnd:
            for bounds, tag in (
                (_monitor_rect_for_hwnd(hwnd), "monitor"),
                (_window_rect(hwnd), "window"),
            ):
                if not bounds:
                    continue
                try:
                    image = _capture_screen_rect(bounds)
                    if image is not None and min(image.size) >= 64:
                        method = f"{tag}_bitblt"
                        used_bounds = bounds
                        break
                    image = None
                except Exception as exc:
                    _log_capture(f"{tag} fail: {exc}")

        if image is None and IS_WINDOWS and hwnd:
            try:
                image = _capture_hwnd_printwindow(hwnd)
                if image is not None:
                    method = "printwindow"
            except Exception as exc:
                _log_capture(f"printwindow fail: {exc}")

        if image is None:
            return False, "Ekran goruntusu alinamadi.", {}

        if output_path is None:
            handle = tempfile.NamedTemporaryFile(prefix="jarvis-screen-", suffix=".png", delete=False)
            output_path = Path(handle.name)
            handle.close()
        image.save(output_path)

        try:
            debug = Path(__file__).resolve().parent.parent / "logs" / "last_elic_capture.png"
            debug.parent.mkdir(parents=True, exist_ok=True)
            image.save(debug)
        except Exception:
            pass

        w, h = image.size
        _log_capture(
            f"ok method={method} size={w}x{h} bounds={used_bounds} "
            f"title={window_title!r} hwnd={hwnd}"
        )

        for name in ("Derin Tarama Asistan", "Derin Tarama", "DTA"):
            if raise_window_topmost(name, steal_focus=False):
                break

        return True, "ok", {
            "image_path": str(output_path),
            "owner_name": owner_name,
            "window_title": window_title,
            "bounds": {"width": w, "height": h, "rect": list(used_bounds) if used_bounds else []},
            "detail": method or "fullscreen",
        }
    except Exception as exc:
        _log_capture(f"ERR {exc}")
        for name in ("Derin Tarama Asistan", "Derin Tarama", "DTA"):
            raise_window_topmost(name, steal_focus=False)
        return False, str(exc), {}
