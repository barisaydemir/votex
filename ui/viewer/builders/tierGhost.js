import * as THREE from "three";
import { makeDetailSprite } from "../labels.js";

/** Kademeli derinlik hayalet rengi (mor/eflatun) — tier'a göre tonlanır. */
export function tierGhostColor(tier) {
  return tier >= 2 ? 0x9a6bff : 0xb08bff;
}

export function tierBadgeText(tier) {
  return `T${tier} · olası derin`;
}

/**
 * tier>0 adaylarını "hayalet" stiline çevirir: düşük opaklık + mor kenar tonu.
 * Materyalleri yerinde soldurup kenar renklerini eflatuna çeker.
 */
export function applyTierGhost(group, tier) {
  const t = Number(tier ?? 0);
  if (!group || t <= 0) return group;
  const tint = new THREE.Color(tierGhostColor(t));
  group.traverse((obj) => {
    if (obj.isSprite) return; // etiket/rozet sprite'larını soldurma
    const mat = obj.material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach((m) => {
      if (m.opacity !== undefined) {
        m.transparent = true;
        m.opacity = Math.max(0.12, (m.opacity ?? 1) * 0.42);
      }
      // Çizgi/kenar materyallerini mor tona çek (hayalet vurgusu)
      if (obj.isLine || obj.isLineSegments) {
        m.color = tint.clone();
      }
    });
  });
  group.userData.tier = t;
  return group;
}

/**
 * Yapının detay etiketine "olası derin (Tn)" + fizik derinlik kestirimini ekler.
 * Var olan başlık/satırlara dokunmadan yalnızca ek bir hayalet etiketi döndürür.
 */
export function makeTierLabel(tier, depthEstimateM) {
  const t = Number(tier ?? 0);
  if (t <= 0) return null;
  const d = Number(depthEstimateM ?? 0);
  const lines = [d > 0 ? `fizik derinlik ~${d.toFixed(1)} m` : "zayıf sinyal"];
  const label = makeDetailSprite(tierBadgeText(t), lines);
  return label;
}
