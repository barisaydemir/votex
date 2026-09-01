/**
 * labelFade.js — 3D etiket okunurluğu.
 *
 * Rozet ve detay etiketleri için:
 *   1. Arazi gizlemesi: kamera→etiket doğrusu zemin yükseklik alanının altına
 *      inerse etiket "toprak arkasında"dır → opaklık çok düşürülür.
 *      (Raycast yerine analitik örnekleme — heightfield'da hem doğru hem ucuz.)
 *   2. Mesafe solması: uzaklaşan etiketler yumuşakça solar, kalabalık azalır.
 *
 * Yalnızca render-on-demand tick'inde, kare çizilirken çağrılır.
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { sampleTerrainY } from "./ground.js";

// Mesafe solması ayarları (metre)
const FADE_START = 40;
const FADE_END = 110;
const FAR_MIN_OPACITY = 0.15;
const OCCLUDED_OPACITY = 0.12;

const _camPos = new THREE.Vector3();
const _sprPos = new THREE.Vector3();
const _segPos = new THREE.Vector3();

// Sprite listesi önbelleği — sahne değiştiğinde yeniden toplanır
let _cachedSprites = null;
let _lastGroundVersion = null;

/** Sprite listesini yeniden topla. Sahne_only_structure_only change_->rebuild. */
function rebuildSpriteCache() {
  _cachedSprites = [];
  const roots = [state.structureGroup, state.freeDrawGroup];
  for (const root of roots) {
    if (!root) continue;
    root.traverse((o) => {
      if (o.isSprite && (o.userData?.isBadge || o.userData?.isDetailLabel)) _cachedSprites.push(o);
    });
  }
  // ground version değiştiyse de yenile (reset sangatı)
  _lastGroundVersion = state.groundPlane?.id ?? null;
}

/** Sprite listesi hâlâ geçerli mi? (yeni yapı eklendiyse false) */
function getSpriteCache() {
  const gId = state.groundPlane?.id ?? null;
  if (!_cachedSprites || gId !== _lastGroundVersion) rebuildSpriteCache();
  return _cachedSprites;
}

/** clearStructures çağrısında sprite önbelleğini sıfırla. */
export function invalidateLabelCache() {
  _cachedSprites = null;
  _lastGroundVersion = null;
}

/** Kamera→hedef doğrusu arazinin altına iniyor mu? (harita ayak izi içinde örneklenir) */
function isOccluded(ground, steps = 12) {
  for (let s = 2; s < steps; s++) {
    const t = s / steps;
    _segPos.lerpVectors(_camPos, _sprPos, t);
    const ty = sampleTerrainY(ground, _segPos.x, _segPos.z);
    if (ty === null) continue; // ayak izi dışı örnekler araziyi bloklayamaz
    if (_segPos.y < ty - 0.06) return true;
  }
  return false;
}

/** Tick başına bir kez: sahnede görünen tüm etiketlerin opaklığını güncelle. */
export function updateLabelFade() {
  const cam = state.camera;
  if (!cam || !state.scene) return;
  cam.getWorldPosition(_camPos);

  const ground = state.groundPlane;
  const occludeOk =
    !!ground && !!ground.userData?.relief && ground.visible && !ground.material?.wireframe;

  // Sprite listesi önbellekli — yapı değiştiğinde yeniden toplanır
  const sprites = getSpriteCache();
  if (!sprites || !sprites.length) return;

  for (const sp of sprites) {
    if (!sp.visible) continue;
    sp.getWorldPosition(_sprPos);

    let op = 1;

    // Mesafe solması
    const dist = _camPos.distanceTo(_sprPos);
    if (dist > FADE_START) {
      const k = 1 - (dist - FADE_START) / (FADE_END - FADE_START);
      op *= Math.max(FAR_MIN_OPACITY, k);
    }

    // Zemin arkası gizlemesi
    if (op > 0.05 && occludeOk && isOccluded(ground)) {
      op *= OCCLUDED_OPACITY;
    }

    const mat = sp.material;
    if (!mat) continue;
    const base = sp.userData.baseOpacity ?? (sp.userData.baseOpacity = mat.opacity ?? 1);
    const target = Math.round(base * op * 1000) / 1000;
    if (Math.abs((mat.opacity ?? 1) - target) > 0.01) {
      mat.opacity = target;
    }
  }
}
