/**
 * structureColors.js — Yapı Tespit Renk Haritası
 *
 * Her renk şeması (magnetic, ocean, thermal, vb.) için
 * oda, tünel, metal yapılarına özel renkler tanımlar.
 * Palette değişince 3D sahnedeki yapılar otomatik yeniden renklendirilir.
 *
 * Tamamen bağımsız — silindiğinde yapılar kendi orijinal renklerine döner.
 */
import * as THREE from "three";
import { state } from "../app/state.js";

/* ── Şema Bazlı Yapı Renkleri ───────────────────────── */

/**
 * Her paletteKey için yapı tespit renkleri.
 * Renkler: { primary, secondary, emissive, opacity }
 */
const SCHEME_COLORS = {
  none: null, // Orijinal renkler

  magnetic: {
    label: "Manyetik Yoğunluk",
    chamber: { primary: 0x3edc8c, secondary: 0x1a8050, emissive: 0x0a3020, opacity: 0.55 },
    tunnel: { primary: 0x4a9eff, secondary: 0x1a4080, emissive: 0x0a1030, opacity: 0.45 },
    metal: { primary: 0xff6a4a, secondary: 0xcc3020, emissive: 0x4a1208, opacity: 0.65 },
  },

  depth: {
    label: "Derinlik Haritası",
    chamber: { primary: 0x38d890, secondary: 0x186848, emissive: 0x082818, opacity: 0.5 },
    tunnel: { primary: 0x20b0e0, secondary: 0x104868, emissive: 0x081828, opacity: 0.4 },
    metal: { primary: 0xffd060, secondary: 0xcc8820, emissive: 0x402808, opacity: 0.6 },
  },

  thermal: {
    label: "Termal",
    chamber: { primary: 0xff8040, secondary: 0xcc4020, emissive: 0x401808, opacity: 0.55 },
    tunnel: { primary: 0xa040c0, secondary: 0x602080, emissive: 0x200830, opacity: 0.45 },
    metal: { primary: 0xffe080, secondary: 0xccaa40, emissive: 0x403010, opacity: 0.65 },
  },

  military: {
    label: "Askeri",
    chamber: { primary: 0x80c040, secondary: 0x508020, emissive: 0x203008, opacity: 0.5 },
    tunnel: { primary: 0x609030, secondary: 0x305018, emissive: 0x102008, opacity: 0.4 },
    metal: { primary: 0xc0b060, secondary: 0x908030, emissive: 0x302810, opacity: 0.6 },
  },

  ocean: {
    label: "Okyanus",
    chamber: { primary: 0x40c0e0, secondary: 0x2080a0, emissive: 0x082030, opacity: 0.5 },
    tunnel: { primary: 0x2090d0, secondary: 0x105080, emissive: 0x081828, opacity: 0.4 },
    metal: { primary: 0x80e0ff, secondary: 0x40a0cc, emissive: 0x103040, opacity: 0.6 },
  },

  mono: {
    label: "Gri Tonları",
    chamber: { primary: 0xa0a0a0, secondary: 0x606060, emissive: 0x202020, opacity: 0.5 },
    tunnel: { primary: 0x808080, secondary: 0x484848, emissive: 0x181818, opacity: 0.4 },
    metal: { primary: 0xd0d0d0, secondary: 0x909090, emissive: 0x303030, opacity: 0.6 },
  },

  metal: {
    label: "Metal Avcısı",
    chamber: { primary: 0xc8a050, secondary: 0x907030, emissive: 0x302010, opacity: 0.55 },
    tunnel: { primary: 0xa08040, secondary: 0x705020, emissive: 0x201008, opacity: 0.45 },
    metal: { primary: 0xffe080, secondary: 0xffb020, emissive: 0x604010, opacity: 0.7 },
  },
};

/* ── Renklendirme Motoru ────────────────────────────── */

/**
 * Bir Three.js nesnesinin tüm alt mesh'lerini renklendir.
 * @param {THREE.Object3D} object — mesh veya group
 * @param {Object} colors — { primary, secondary, emissive, opacity }
 * @param {string} type — "chamber" | "tunnel" | "metal"
 */
function recolorObject(object, colors, type) {
  if (!object || !colors) return;

  object.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.isBadge || child.userData?.isDetailLabel) return;

    const mat = child.material;
    if (!mat) return;

    // Orijinal rengi sakla (ilk kez)
    if (!child.userData._origStructColor) {
      child.userData._origStructColor = mat.color?.clone?.();
      child.userData._origStructEmissive = mat.emissive?.clone?.();
      child.userData._origStructOpacity = mat.opacity;
    }

    // Yeni rengi uygula
    if (mat.color) {
      // Wireframe ise secondary, değilse primary
      const isWire = child.userData?.isWireframe || mat.wireframe;
      const targetColor = isWire ? colors.secondary : colors.primary;
      mat.color.setHex(targetColor);
    }

    if (mat.emissive) {
      mat.emissive.setHex(colors.emissive);
    }

    // Opaklık — wireframe için daha düşük
    const isWire = child.userData?.isWireframe || mat.wireframe;
    mat.opacity = isWire ? Math.min(colors.opacity, 0.3) : colors.opacity;
    mat.transparent = true;
    mat.needsUpdate = true;
  });
}

/**
 * Orijinal renklere geri dön.
 * @param {THREE.Object3D} object
 */
function restoreOriginalColors(object) {
  if (!object) return;

  object.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData?.isBadge || child.userData?.isDetailLabel) return;

    const mat = child.material;
    if (!mat) return;

    if (child.userData._origStructColor) {
      mat.color.copy(child.userData._origStructColor);
      delete child.userData._origStructColor;
    }
    if (child.userData._origStructEmissive) {
      mat.emissive.copy(child.userData._origStructEmissive);
      delete child.userData._origStructEmissive;
    }
    if (child.userData._origStructOpacity !== undefined) {
      mat.opacity = child.userData._origStructOpacity;
      delete child.userData._origStructOpacity;
    }

    mat.needsUpdate = true;
  });
}

/* ── Public API ──────────────────────────────────────── */

/**
 * Belirli bir renk şemasını 3D sahnedeki yapılara uygula.
 * @param {string} paletteKey — renk şeması anahtarı
 * @param {Object} [structureGroup] — THREE.Group (yapılar)
 */
export function applyStructureColors(paletteKey, structureGroup) {
  const scheme = SCHEME_COLORS[paletteKey];
  const group = structureGroup || state.structureGroup;

  if (!group) {
    console.warn("[StructureColors] structureGroup bulunamadı");
    return;
  }

  // "none" ise orijinale dön
  if (!scheme) {
    group.traverse((child) => {
      if (child.isMesh && child.userData._origStructColor) {
        restoreOriginalColors(child);
      }
    });
    console.log("[StructureColors] Orijinal renklere dönüldü");
    return;
  }

  console.log(`[StructureColors] "${scheme.label}" şeması uygulanıyor`);

  // Tüm yapıları dolaş ve türlerine göre renklendir
  group.children.forEach((structGroup) => {
    // Yapı türünü belirle
    const structType = structGroup.userData?.type ||
      structGroup.userData?.kind ||
      guessStructType(structGroup);

    const colors = scheme[structType];
    if (colors) {
      recolorObject(structGroup, colors, structType);
    }
  });
}

/**
 * Tüm yapı renklerini orijinal haline döndür.
 * @param {Object} [structureGroup]
 */
export function resetStructureColors(structureGroup) {
  const group = structureGroup || state.structureGroup;
  if (!group) return;

  group.traverse((child) => {
    if (child.isMesh && child.userData._origStructColor) {
      restoreOriginalColors(child);
    }
  });

  console.log("[StructureColors] Tüm renkler sıfırlandı");
}

/**
 * Mevcut şema renklerini döndür.
 * @param {string} paletteKey
 * @returns {Object|null}
 */
export function getSchemeColors(paletteKey) {
  return SCHEME_COLORS[paletteKey] || null;
}

/**
 * Tüm şema isimlerini döndür.
 * @returns {Object} { key: label }
 */
export function getSchemeLabels() {
  const labels = {};
  for (const [key, scheme] of Object.entries(SCHEME_COLORS)) {
    labels[key] = scheme?.label || "Orijinal";
  }
  return labels;
}

/* ── Yardımcılar ─────────────────────────────────────── */

/**
 * Yapının türünü geometrisinden tahmin et.
 * (userData.type yoksa)
 */
function guessStructType(group) {
  // Büyük küp/kutu → oda
  // Uzun silindir → tünel
  // Küçük/yoğun → metal
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);
  const minDim = Math.min(size.x, size.y, size.z);
  const ratio = maxDim / (minDim || 1);

  if (ratio > 2.5) return "tunnel"; // Uzun → tünel
  if (maxDim < 2) return "metal"; // Küçük → metal
  return "chamber"; // Diğer → oda
}
