import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { state } from "../../app/state.js";
import { colorByDepth, formatDepthM } from "../colors.js";
import { makeBadgeSprite, makeDetailSprite } from "../labels.js";
import { mapToWorld } from "../coords.js";
import { makeShaft } from "./shaft.js";
import { applyTierGhost, makeTierLabel } from "./tierGhost.js";
import { t } from "../../i18n/index.js";

function finishChamber(group, ch, id, num, kindLabel, detailTop, radius, sy) {
  group.userData.focusId = id;
  group.userData.type = "chamber";
  const badge = makeBadgeSprite(num, "#7eb6ff");
  badge.position.set(0.2 * ((num % 3) - 1), sy * 0.55 + 0.7, 0.1);
  group.add(badge);
  const detail = makeDetailSprite(`${num}. ${kindLabel}`, [
    `yüzey ${formatDepthM(detailTop)}`,
  ]);
  detail.position.set(0, sy * 0.55 + 2.2, 0);
  group.add(detail);
  state.structureTargets[id] = {
    position: group.position.clone(),
    object: group,
    detailLabel: detail,
    radius,
    title: `${num}. ${kindLabel}`,
    depthM: detailTop,
  };
  const tier = Number(ch.tier ?? 0);
  if (tier > 0) {
    applyTierGhost(group, tier);
    const tl = makeTierLabel(tier, ch.depthEstimateM ?? ch.depth_estimate_m);
    if (tl) {
      tl.position.set(0, sy * 0.55 + 2.6, 0);
      group.add(tl);
    }
  }
  return group;
}

/** 1 world unit = 1 metre; vertExag dikey abartı */
export function makeChamber(ch, mapW, mapD, vertExag, wireframe, id, num, sideView = false) {
  const topM = Number(ch.topFromSurfaceM ?? ch.top_from_surface_m ?? 0.4);
  const botM = Number(ch.bottomFromSurfaceM ?? ch.bottom_from_surface_m ?? topM + 2.5);
  const hM = Math.max(Number(ch.heightM ?? ch.height_m ?? botM - topM), 0.4);
  if (ch.kind === "shaft") {
    return makeShaft(ch, mapW, mapD, vertExag, wireframe, id, num, sideView);
  }
  // Konum = blob (cx,cy) — ortaya çekilmez
  const { x, z } = mapToWorld(Math.max(0, Math.min(1, ch.cx)), Math.max(0, Math.min(1, ch.cy)), mapW, mapD, sideView);
  const wM = Number(ch.widthM ?? ch.width_m ?? ch.rx * 2 * mapW);
  const lM = Number(ch.lengthM ?? ch.length_m ?? ch.ry * 2 * mapD);

  // Yan: Z ince kesit — mavi leke üzerinde; ry×mapD şişirmesi yok
  const sx = Math.max(wM, 0.15);
  const sz = sideView ? Math.max(Math.min(lM, 1.8), 0.5) : Math.max(lM, 0.15);
  const sy = Math.max(hM, 0.15) * vertExag;
  // Yapı gerçek derinliğine gömülür — üst kenarı topM derinliğinde, aşağıya iner
  const y = -(topM * vertExag) - sy * 0.5;

  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.userData.focusId = id;
  group.userData.type = "chamber";

  const bearingDeg = Number(
    ch.bearingDeg ?? ch.bearing_deg ?? ch.geometry?.symmetryAxisDeg ?? ch.geometry?.symmetry_axis_deg ?? 0
  );
  // Yan: döndürme yok — kutu mavi ayakizinde kalsın (kırmızı/tünel ayrı)
  if (!sideView && Math.abs(bearingDeg) > 1 && ch.kind !== "shaft") {
    group.rotation.y = -THREE.MathUtils.degToRad(bearingDeg - 90);
  }

  const isTomb = ch.kind === "tomb";
  const isOpenExcavation = topM < 1.5 && !isTomb; // Sığ yapı = üstü açık kazı alanı
  const wallColor = colorByDepth(topM, isTomb ? "tomb" : isOpenExcavation ? "excavation" : "room");

  if (isOpenExcavation) {
    // ── ÜSTÜ AÇIK KAZI ALANI ──
    // Yarı saydam kutu, üstü açık konturlu
    const outer = new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(0.2, Math.min(sx, sy, sz) * 0.1));
    group.add(new THREE.Mesh(outer, new THREE.MeshStandardMaterial({
      color: wallColor, emissive: wallColor, emissiveIntensity: 0.15,
      transparent: true, opacity: 0.3, roughness: 0.7,
      side: THREE.DoubleSide, depthWrite: false,
    })));
    // Kenar çizgileri — üstü açık hissi için sadece üst kontur
    const topEdgeVerts = new Float32Array([
      -sx/2, sy/2, -sz/2,  sx/2, sy/2, -sz/2,
       sx/2, sy/2, -sz/2,  sx/2, sy/2,  sz/2,
       sx/2, sy/2,  sz/2, -sx/2, sy/2,  sz/2,
      -sx/2, sy/2,  sz/2, -sx/2, sy/2, -sz/2,
    ]);
    const topEdgeGeo = new THREE.BufferGeometry();
    topEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(topEdgeVerts, 3));
    group.add(new THREE.LineSegments(topEdgeGeo,
      new THREE.LineBasicMaterial({ color: 0xc8a050, transparent: true, opacity: 0.9 })
    ));
    // Tüm kenar çizgileri
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(outer),
      new THREE.LineBasicMaterial({ color: 0xc8a050, transparent: true, opacity: 0.5 })
    ));
  } else {

  // ── KAPALI ODA / MEZAR ──
  const outer = new RoundedBoxGeometry(sx, sy, sz, 3, Math.min(0.25, Math.min(sx, sy, sz) * 0.12));

  group.add(
    new THREE.Mesh(
      outer,
      new THREE.MeshStandardMaterial({
        color: wallColor,
        emissive: wallColor,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: wireframe ? 0.45 : 0.6,
        roughness: 0.55,
        metalness: 0.08,
        side: THREE.DoubleSide,
        wireframe: !!wireframe,
        depthWrite: false,
      })
    )
  );

  const inset = 0.92;
  group.add(
    new THREE.Mesh(
      new RoundedBoxGeometry(sx * inset, sy * inset, sz * inset, 2, 0.08),
      new THREE.MeshStandardMaterial({
        color: 0x0c1418,
        transparent: true,
        opacity: 0.4,
        roughness: 0.9,
        side: THREE.BackSide,
        depthWrite: false,
      })
    )
  );

  // Kenar çizgisi
  const wallS = Number(ch.evidence?.wallSupport ?? ch.evidence?.wall_support ?? 0.3);
  group.add(
    new THREE.LineSegments(
      new THREE.EdgesGeometry(outer),
      new THREE.LineBasicMaterial({
        color: 0xf2f0e6,
        transparent: true,
        opacity: Math.min(0.95, 0.6 + wallS * 0.35),
      })
    )
  );
  } // else (kapalı oda bloğu sonu)

  const kindLabel = isTomb ? "Mezar odası" : isOpenExcavation ? "Kazı alanı" : "Oda";
  const badge = makeBadgeSprite(num, "#7eb6ff");
  badge.position.set(sx * 0.15 * ((num % 3) - 1), sy * 0.55 + 0.9, sz * 0.1 * ((num % 2) * 2 - 1));
  group.add(badge);

  const detailTop = topM + (Number(state.structureKotM?.[id]) || 0);
  const detail = makeDetailSprite(`${num}. ${kindLabel}`, [
    `merkez noktası: ${x.toFixed(1)}, ${(-detailTop).toFixed(1)}, ${z.toFixed(1)} m`,
    `yüzey ${formatDepthM(detailTop)} · ${sx.toFixed(1)}×${sz.toFixed(1)}×${Number(hM).toFixed(2)} m`,
  ]);
  detail.position.set(0, sy * 0.55 + 2.2, 0);
  group.add(detail);

  state.structureTargets[id] = {
    position: new THREE.Vector3(x, y, z),
    object: group,
    detailLabel: detail,
    radius: Math.max(sx, sz, sy) * 0.6,
    title: `${num}. ${kindLabel}`,
    depthM: detailTop,
  };

  const tier = Number(ch.tier ?? 0);
  if (tier > 0) {
    applyTierGhost(group, tier);
    const tl = makeTierLabel(tier, ch.depthEstimateM ?? ch.depth_estimate_m);
    if (tl) {
      tl.position.set(0, sy * 0.55 + 2.6, 0);
      group.add(tl);
    }
  }

  return group;
}
