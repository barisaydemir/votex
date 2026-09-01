import * as THREE from "three";
import { state } from "../../app/state.js";
import { colorByDepth, edgeColorByDepth, formatDepthM } from "../colors.js";
import { makeBadgeSprite, makeDetailSprite } from "../labels.js";
import { mapToWorld } from "../coords.js";
import { t } from "../../i18n/index.js";

/** Dikey şaft — konum blob (cx,cy); gövde −Y. */
export function makeShaft(ch, mapW, mapD, vertExag, wireframe, id, num, sideView = false) {
  const topM = Number(ch.topFromSurfaceM ?? ch.top_from_surface_m ?? 0.08);
  const botM = Number(ch.bottomFromSurfaceM ?? ch.bottom_from_surface_m ?? 7.5);
  const hM = Math.max(Number(ch.heightM ?? ch.height_m ?? botM - topM), 0.4);
  const wM = ch.widthM ?? ch.width_m ?? 1.5;
  const lM = ch.lengthM ?? ch.length_m ?? wM;
  const diam = Math.max(Math.min(wM, lM), 0.45);
  const { x, z } = mapToWorld(Math.max(0, Math.min(1, ch.cx)), Math.max(0, Math.min(1, ch.cy)), mapW, mapD, sideView);
  const rTop = diam * 0.52;
  const rBot = diam * 0.45;
  const sy = hM * vertExag;
  const mouthY = -topM * vertExag;

  const group = new THREE.Group();
  group.position.set(x, mouthY, z);
  group.userData.focusId = id;

  const bearingDeg = Number(ch.bearingDeg ?? ch.bearing_deg ?? 0);
  if (Math.abs(bearingDeg) > 1) {
    group.rotation.y = -THREE.MathUtils.degToRad(bearingDeg);
  }

  const wallColor = colorByDepth(topM, "shaft");
  const edgeColor = edgeColorByDepth(topM, "shaft");
  const deepColor = colorByDepth(Math.min(topM + hM * 0.85, botM), "shaft");

  const wallMat = new THREE.MeshStandardMaterial({
    color: wallColor,
    transparent: true,
    opacity: wireframe ? 0.28 : 0.48,
    roughness: 0.72,
    metalness: 0.05,
    side: THREE.DoubleSide,
    wireframe: !!wireframe,
    depthWrite: false,
  });

  // —— Gövde: ağızdan tabana uzun silindir ——
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, sy, 28, 6, true),
    wallMat
  );
  body.position.y = -sy * 0.5;
  group.add(body);

  // İç boşluk (kuyu kovuğu)
  const bore = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop * 0.78, rBot * 0.78, sy * 0.99, 24, 4, true),
    new THREE.MeshStandardMaterial({
      color: 0x050c12,
      transparent: true,
      opacity: 0.72,
      side: THREE.BackSide,
      roughness: 1,
      depthWrite: false,
    })
  );
  bore.position.y = -sy * 0.5;
  group.add(bore);

  // Derinlik halkaları (her ~1.5–2 m) — aşağı inişi okunaklı yapar
  const ringStep = Math.max(1.4, hM / 5);
  const ringMat = new THREE.MeshStandardMaterial({
    color: edgeColor,
    transparent: true,
    opacity: 0.55,
    roughness: 0.45,
    metalness: 0.15,
    depthWrite: false,
  });
  for (let d = ringStep; d < hM - 0.35; d += ringStep) {
    const t = d / hM;
    const rr = rTop * (1 - t) + rBot * t;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(rr * 0.92, Math.min(0.04, rr * 0.06), 8, 28),
      ringMat
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -d * vertExag;
    group.add(ring);
  }

  // —— Kapak / ağız (yüzeyde) ——
  const cover = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop * 1.18, rTop * 1.12, Math.max(0.08, 0.12 * vertExag), 32),
    new THREE.MeshStandardMaterial({
      color: 0xc4b89a,
      emissive: 0x2a2418,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity: wireframe ? 0.35 : 0.78,
      roughness: 0.55,
      metalness: 0.12,
      depthWrite: false,
    })
  );
  cover.position.y = 0.02;
  group.add(cover);

  // Kapak deliği (orta boşluk)
  const aperture = new THREE.Mesh(
    new THREE.CircleGeometry(rTop * 0.72, 28),
    new THREE.MeshStandardMaterial({
      color: 0x030810,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  aperture.rotation.x = -Math.PI / 2;
  aperture.position.y = 0.06;
  group.add(aperture);

  // Ağız kenar halkası
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rTop * 1.05, Math.min(0.1, rTop * 0.14), 10, 36),
    new THREE.MeshStandardMaterial({
      color: edgeColor,
      emissive: 0x1a3040,
      emissiveIntensity: 0.25,
      roughness: 0.35,
      metalness: 0.25,
    })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.05;
  group.add(rim);

  // —— Taban ——
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(rBot * 0.95, 24),
    new THREE.MeshStandardMaterial({
      color: deepColor,
      transparent: true,
      opacity: 0.55,
      roughness: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -sy + 0.02;
  group.add(floor);

  // Siluet kenarları
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.CylinderGeometry(rTop, rBot, sy, 12, 1, true)),
    new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: 0.75,
    })
  );
  outline.position.y = -sy * 0.5;
  group.add(outline);

  // Düşey derinlik oku (tam gövde boyunca)
  const arrowLen = sy * 0.92;
  group.add(
    new THREE.ArrowHelper(
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(rTop * 1.35, 0.05, 0),
      arrowLen,
      0xffc86a,
      Math.min(0.45, arrowLen * 0.08),
      Math.min(0.28, arrowLen * 0.05)
    )
  );

  const title = `${num}. Kuyu (dikey şaft)`;
  const badge = makeBadgeSprite(num, "#6fd0c0");
  badge.position.set(rTop * 0.15, 1.05, 0);
  group.add(badge);

  const detailTop = topM + (Number(state.structureKotM?.[id]) || 0);
  const detail = makeDetailSprite(title, [
    `çap ${diam.toFixed(1)} m`,
    `derinlik ${hM.toFixed(1)} m · kapak ${formatDepthM(detailTop)}`,
  ]);
  detail.position.set(0, 1.9, 0);
  group.add(detail);

  const midY = mouthY - sy * 0.5;
  state.structureTargets[id] = {
    position: new THREE.Vector3(x, midY, z),
    object: group,
    detailLabel: detail,
    radius: Math.max(diam, hM * 0.4) * 0.65,
    title,
    depthM: detailTop,
  };

  return group;
}
