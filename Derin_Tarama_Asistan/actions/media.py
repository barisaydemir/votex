"""
Medya oynatma - Windows uyumlu Spotify, YouTube ve web muzik akislari.
"""

from __future__ import annotations

import urllib.parse

from actions.browser import browser_control
from actions.windows_utils import open_uri, open_url, press_enter_after_delay


def _play_youtube(query: str) -> str:
    return browser_control("play_youtube", query=query)


def _play_spotify(query: str, autoplay: bool = True) -> str:
    search_url = f"spotify:search:{urllib.parse.quote(query.strip())}"
    ok, detail = open_uri(search_url)
    if not ok:
        return f"Spotify acilamadi: {detail}"

    if not autoplay:
        return f"Spotify icinde '{query}' aramasi acildi."

    ok, detail = press_enter_after_delay(2.0)
    if ok:
        return f"Spotify'da oynatiliyor: {query}"
    return (
        f"Spotify aramasi acildi ama otomatik oynatma tamamlanamadi: {detail}. "
        "pyautogui kuruluysa Enter otomasyonu calisir."
    )


def _play_web_music(query: str) -> str:
    search_url = f"https://music.youtube.com/search?q={urllib.parse.quote(query.strip())}"
    open_url(search_url)
    return f"YouTube Music aramasi acildi: {query}"


def play_media(query: str, provider: str = "auto", autoplay: bool = True) -> str:
    if not query or not query.strip():
        return "Calinacak icerik belirtilmedi."

    normalized_provider = (provider or "auto").strip().lower()
    if normalized_provider in {"yt", "youtube"}:
        return _play_youtube(query)
    if normalized_provider in {"spotify"}:
        return _play_spotify(query, autoplay=autoplay)
    if normalized_provider in {"apple music", "music", "apple_music", "youtube music"}:
        return _play_web_music(query)

    result = _play_spotify(query, autoplay=autoplay)
    if "acilamadi" not in result:
        return result
    return _play_youtube(query)
