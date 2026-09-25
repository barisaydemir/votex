"""
Çift ekran çalışma alanı: Proton ELIC + VOTEX.

Operatör iki monitör kullanır — ELIC birinde, VOTEX diğerinde.
analyze_workspace_screens: açık olanları bulur, mevcut algoritmalarla değerlendirir.
"""

from __future__ import annotations

from app_config import get_app_config_value
from actions.windows_utils import find_window_visible


def _elic_candidates() -> list[str]:
    primary = str(get_app_config_value("elic_window_title", "ELIC") or "ELIC").strip()
    out = [primary]
    for alt in ("Proton ELIC", "ELIC", "Proton"):
        if alt.lower() not in {x.lower() for x in out}:
            out.append(alt)
    return out


def _votex_candidates() -> list[str]:
    primary = str(get_app_config_value("votex_window_title", "Votex") or "Votex").strip()
    out = [primary]
    for alt in ("VOTEX", "Votex", "Tactical Command", "Manyetik Anomali"):
        if alt.lower() not in {x.lower() for x in out}:
            out.append(alt)
    return out


def detect_open_screens() -> dict:
    """Hangi saha/ofis pencereleri acik?"""
    elic_ok, elic_title = find_window_visible(*_elic_candidates())
    votex_ok, votex_title = find_window_visible(*_votex_candidates())
    return {
        "elic_open": elic_ok,
        "elic_title": elic_title,
        "votex_open": votex_ok,
        "votex_title": votex_title,
    }


def analyze_workspace_screens(query: str = "Ekranlari yorumla") -> str:
    """
    Acik ELIC ve/veya VOTEX pencerelerini yakala ve degerlendir.
    VOTEX gorunurse mevcut heatmap/HUD/inference + 3D kilavuz ile yorumlar.
    """
    from actions.elic_vision import analyze_elic_screen
    from actions.votex_vision import analyze_votex_screen

    detected = detect_open_screens()
    sections: list[str] = []
    q = (query or "Ekranlari yorumla").strip()

    if detected["elic_open"]:
        sections.append(analyze_elic_screen(q))
    else:
        sections.append(
            "[ELIC] Pencere bulunamadi — Proton ELIC acik mi? "
            f"(aranan: {', '.join(_elic_candidates())})"
        )

    if detected["votex_open"]:
        sections.append(analyze_votex_screen(q))
    else:
        sections.append(
            "[VOTEX] Pencere bulunamadi — VOTEX acik mi? "
            f"(aranan: {', '.join(_votex_candidates())})"
        )

    if not detected["elic_open"] and not detected["votex_open"]:
        return (
            "Ne ELIC ne VOTEX penceresi gorunmuyor. "
            "Iki monitörde de uygulamalar acik olsun; basliklar "
            "config/api_keys.json icindeki elic_window_title / votex_window_title ile eslesmeli."
        )

    cross = ""
    if detected["elic_open"] and detected["votex_open"]:
        cross = (
            "\n\n=== CAPRAZ OZET ===\n"
            f"ELIC: {detected['elic_title'] or 'acik'}\n"
            f"VOTEX: {detected['votex_title'] or 'acik'}\n"
            "ELIC = ham manyetik/HUD; VOTEX = ayni haritanin 3D yapi dogrulamasi. "
            "Celiskide colormap + INTEL sayilarini esas al; ince cizgi ipucudur."
        )

    header = (
        f"[CALISMA ALANI] ELIC={'acik' if detected['elic_open'] else 'yok'} · "
        f"VOTEX={'acik' if detected['votex_open'] else 'yok'}\n"
    )
    return header + "\n\n---\n\n".join(sections) + cross
