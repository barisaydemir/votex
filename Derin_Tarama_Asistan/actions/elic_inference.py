"""
Proton ELIC sensör modeli + çapraz çıkarım motoru.

Cihaz: PROTON ELIC (LiDAR + Manyetik + Termal + Lazer işaretleyici)
Yazılım: Derin Tarama Asistan (DTA) — Barış Aydemir / Digital Future Tech
"""

from __future__ import annotations

from typing import Any


# ---------------------------------------------------------------------------
# Donanım / ekran modeli (kaynak gerçeklik)
# ---------------------------------------------------------------------------
SENSOR_MODEL = {
    "lidar": {
        "role": "zemin_referansi",
        "ekran": "yesil_yuzey",
        "aciklama": (
            "Ilk acilista yesil alan dolar. LiDAR cihaz-zemin mesafesini sifirlar "
            "ve yuzeyi olusturur. Yatay mesafe VERMEZ."
        ),
    },
    "magnetic": {
        "role": "birincil_anomali",
        "ekran": "renkli_isi_haritasi",
        "aciklama": (
            "Yeryuzu manyetik cekim etkisinden yararlanir; sinyal nesnelerin "
            "etrafından suzulerek renkli haritayi olusturur. Ince kenar cizgileri "
            "ipucu niteligindedir (kesin tesbit degil)."
        ),
    },
    "thermal": {
        "role": "capraz_dogrulama",
        "ekran": "termal_harita",
        "aciklama": "Manyetik bulgu sonrasi dogrulama icin kullanilir.",
    },
    "laser": {
        "role": "hedef_isareti",
        "ekran": "merkeze_yakin_daire_ve_depth",
        "aciklama": (
            "Ortadaki daire lazerin isaretledigi noktadir; hemen yanindaki Depth "
            "yazisi tam o orta noktanin baktigi yeralti derinligidir."
        ),
    },
}

# Ekran HUD duzeni (Proton ELIC okuma ekrani)
HUD_LAYOUT = {
    "center_circle": "Lazer hedefi (isaretlenen nokta)",
    "depth_label": "Daire yaninda Depth — orta noktanin baktiyi derinligi",
    "top_compass_tape": "Ustteki yatay cizgi — tam yon (N, NW, derece)",
    "side_anomaly_gauge": "Yandaki dikey gosterge — anomalik deger olcegi",
}

COLOR_LEGEND = {
    "green": "LiDAR yuzeyi / dogal zemin (baslangic dolumu)",
    "blue": "Bosluk veya su (net mavi alan)",
    "white_edge_blue": (
        "Mavi alan cevresinde isik cikiyormus gibi ince beyaz cizgiler = duvar"
    ),
    "white_edge_red": (
        "Kirmizi gecislerinde ayni ince beyaz isik cizgileri = duvar / sert kenar ipucu "
        "(metal veya manyetik cismin siniri)"
    ),
    "red": "Metal veya guclu manyetik alan (bosluk icinde de olabilir)",
    "yellow": "Gecis / ara yogunluk",
    "glow": (
        "Yesil alanin altindan disariya isik cikiyormus gibi ince, beyaza yakin "
        "cizgiler = buyuk olasilikla oda veya tunel (gizli bosluk) ipucu"
    ),
    "note": (
        "Ince cizgiler ipucu niteligindedir: manyetik alan nesne etrafindan "
        "suzulerek bu renkleri uretir."
    ),
}


def infer_scene(analysis: dict[str, Any]) -> dict[str, Any]:
    """Heatmap + HUD analizinden çapraz çıkarım üretir."""
    stats = dict(analysis.get("heatmap_stats") or {})
    metal_p = float(stats.get("metal_pct", 0) or 0)
    void_p = float(stats.get("void_pct", 0) or 0)
    soil_p = float(stats.get("soil_pct", 0) or 0)
    wall_p = float(stats.get("wall_pct", 0) or 0)
    glow_p = float(stats.get("glow_pct", 0) or 0)

    strongest = analysis.get("strongest_anomaly") or {}
    dominant = list(analysis.get("dominant_signals") or [])
    relations = list(analysis.get("spatial_relations") or [])
    depth_m = analysis.get("depth_m")
    if depth_m is None:
        depth_m = analysis.get("depth_label_m")
    heading = analysis.get("heading_cardinal") or analysis.get("heading")
    surface_ok = analysis.get("surface_ref_ok")
    active = analysis.get("active_sensor") or "magnetic"

    findings: list[str] = []
    hypotheses: list[dict[str, Any]] = []
    actions: list[str] = []

    # --- LiDAR yüzey ---
    if surface_ok or soil_p >= 40:
        findings.append("LiDAR zemin referansi mevcut (yesil yuzey).")
    elif soil_p < 15 and (void_p + metal_p) > 20:
        findings.append("Yesil yuzey zayif; LiDAR referansi zayif veya farkli mod olabilir.")

    # --- Duvar ipuçları (mavi veya kırmızı kenarında ince beyaz) ---
    void_with_wall = any(r.get("type") == "void_with_wall" for r in relations)
    metal_with_wall = any(r.get("type") == "metal_with_wall" for r in relations)
    if wall_p >= 0.3 or void_with_wall or metal_with_wall:
        hyp = {
            "id": "wall_edge",
            "label": "Duvar / sert kenar ipucu",
            "confidence": "orta" if (void_with_wall or metal_with_wall or wall_p >= 0.8) else "dusuk",
            "evidence": [f"wall %{wall_p:.1f}"],
        }
        if void_with_wall:
            hyp["evidence"].append("mavi cevresinde ince beyaz")
            hyp["label"] = "Bosluk cevresinde duvar ipucu"
            findings.append(
                "Mavi alan cevresinde isik cikiyormus gibi ince beyaz cizgiler — duvar anlami."
            )
        if metal_with_wall:
            hyp["evidence"].append("kirmizi gecisinde ince beyaz")
            if void_with_wall:
                hyp["label"] = "Duvar ipucu (mavi ve kirmizi kenarlari)"
            else:
                hyp["label"] = "Metal/kirmizi gecisinde duvar ipucu"
            findings.append(
                "Kirmizi gecislerinde ince beyaz isik cizgileri — duvar/sert kenar ipucu."
            )
        if not void_with_wall and not metal_with_wall and wall_p >= 0.3:
            findings.append(
                "Beyaza yakin ince kenar cizgileri goruluyor; duvar ipucu olabilir."
            )
        hypotheses.append(hyp)

    # --- Boşluk / oda ---
    if void_p >= 2.0 or strongest.get("type") == "void":
        conf = "yuksek" if void_p >= 4 or wall_p >= 1.5 or void_with_wall else "orta"
        hyp = {
            "id": "void_candidate",
            "label": "Bosluk / su / oda adayi",
            "confidence": conf,
            "evidence": [f"mavi_void %{void_p:.1f}"],
        }
        if wall_p >= 0.8 or void_with_wall:
            hyp["evidence"].append(f"kenarda duvar %{wall_p:.1f}")
            hyp["label"] = "Oda / bosluk + duvar adayi"
            hyp["confidence"] = "yuksek" if void_p >= 2 else "orta"
        findings.append(
            f"Mavi bolge bosluk veya su adayi ( %{void_p:.1f} )."
        )
        hypotheses.append(hyp)
        actions.append("Termal sensore gecip boslugu dogrulayin.")

    # --- Metal ---
    if metal_p >= 3.0 or strongest.get("type") == "metal":
        hyp = {
            "id": "metal_candidate",
            "label": "Metal / manyetik anomali",
            "confidence": "yuksek" if metal_p >= 8 else "orta",
            "evidence": [f"kirmizi_metal %{metal_p:.1f}"],
        }
        findings.append(
            f"Kirmizi bolge metal veya guclu manyetik alan ( %{metal_p:.1f} )."
        )
        metal_in_void = any(r.get("type") == "metal_in_void" for r in relations)
        if metal_in_void or (metal_p >= 2 and void_p >= 1.5):
            hyp["id"] = "metal_in_void"
            hyp["label"] = "Bosluk icinde metal / manyetik hedef"
            hyp["confidence"] = "yuksek" if metal_p >= 5 and void_p >= 2 else "orta"
            hyp["evidence"].append(f"ayni sahnede void %{void_p:.1f}")
            findings.append(
                "Metal sinyali bosluk bolgesiyle birlikte: bosluk icinde metal olabilir."
            )
            actions.append("Once manyetik nokta, sonra termal ile ayni bolgeyi dogrulayin.")
        elif metal_with_wall:
            hyp["evidence"].append("metal kenarinda duvar ipucu")
            findings.append(
                "Metal anomalisinin cevresinde ince beyaz kenar — cismin/sinirin duvar isareti olabilir."
            )
            actions.append("Metal tespitini termal ile opsiyonel kontrol edin.")
        else:
            actions.append("Metal tespitini termal ile opsiyonel kontrol edin.")
        hypotheses.append(hyp)

    # --- Glow: yesilden ince beyazımsı ışık çizgileri → oda/tünel ---
    glow_near_void = any(r.get("type") == "glow_near_void" for r in relations)
    if glow_p >= 0.15 or glow_near_void:
        conf = "dusuk"
        if glow_p >= 0.8 or glow_near_void:
            conf = "orta"
        if glow_p >= 2.0 and (void_p >= 1 or glow_near_void):
            conf = "yuksek"
        hyp = {
            "id": "structure_glow",
            "label": "Oda / tunel adayi (yesilden isik cizgileri)",
            "confidence": conf,
            "evidence": [f"glow %{glow_p:.1f}"],
        }
        if glow_near_void:
            hyp["evidence"].append("glow + mavi yakin")
        findings.append(
            "Yesil alanin altindan ince, beyaza yakin isik cizgileri var; "
            "buyuk olasilikla oda veya tunel ipucu."
        )
        hypotheses.append(hyp)
        actions.append("Bu isik cizgilerini termal ile dogrulayin; bosluk adayi olabilir.")

    # --- Depth / laser / HUD ---
    if depth_m is not None:
        findings.append(
            f"Lazer orta noktasi derinligi (daire yani Depth): {float(depth_m):.2f} m."
        )
    if heading:
        findings.append(f"Ust yon cizgisi (pusula): {heading}.")
    anomaly_val = analysis.get("anomaly_gauge")
    if anomaly_val is not None:
        findings.append(f"Yan anomali gostergesi: {anomaly_val}.")

    if active == "thermal":
        findings.append("Aktif sensör: termal (capraz dogrulama modu).")

    if not hypotheses and soil_p >= 60:
        findings.append("Belirgin anomali yok; zemin (yesil) hakim.")
        hypotheses.append({
            "id": "clear_soil",
            "label": "Normal zemin",
            "confidence": "orta",
            "evidence": [f"soil %{soil_p:.1f}"],
        })

    # Öncelikli hipotez
    priority = {"yuksek": 3, "orta": 2, "dusuk": 1}
    hypotheses.sort(key=lambda h: priority.get(h.get("confidence", "dusuk"), 0), reverse=True)
    top = hypotheses[0] if hypotheses else None

    return {
        "sensor_model": SENSOR_MODEL,
        "hud_layout": HUD_LAYOUT,
        "color_legend": COLOR_LEGEND,
        "findings": findings,
        "hypotheses": hypotheses,
        "top_hypothesis": top,
        "recommended_actions": list(dict.fromkeys(actions)),
        "stats": {
            "metal_pct": metal_p,
            "void_pct": void_p,
            "soil_pct": soil_p,
            "wall_pct": wall_p,
            "glow_pct": glow_p,
        },
        "depth_m": depth_m,
        "heading": heading,
        "anomaly_gauge": analysis.get("anomaly_gauge"),
        "active_sensor": active,
        "spatial_relations": relations,
    }


def format_inference_summary(inference: dict[str, Any], *, voice: bool = True) -> str:
    """Saha diliyle kisa ozet."""
    parts: list[str] = []
    top = inference.get("top_hypothesis")
    if top:
        parts.append(
            f"Ana yorum: {top.get('label')} (guven: {top.get('confidence')})."
        )
    findings = inference.get("findings") or []
    # Ses icin 3-4 madde
    for line in findings[:4]:
        parts.append(line)
    actions = inference.get("recommended_actions") or []
    if actions:
        parts.append("Oneri: " + actions[0])
    if not parts:
        return "Ekranda belirgin anomali cikarimi yapilamadi."
    return " ".join(parts)


def should_recommend_thermal_from_inference(inference: dict[str, Any]) -> bool:
    for h in inference.get("hypotheses") or []:
        if h.get("id") in (
            "void_candidate",
            "metal_in_void",
            "structure_glow",
            "wall_edge",
        ):
            return True
        if h.get("id") == "metal_candidate" and h.get("confidence") == "yuksek":
            return True
    return False
