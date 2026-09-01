import * as THREE from "three";
import { state } from "../../app/state.js";
import { formatDepthM } from "../colors.js";
import { makeBadgeSprite, makeDetailSprite } from "../labels.js";
import { mapToWorld } from "../coords.js";

/** Olası su: yarı saydam açık mavi / turkuaz disk. */
export function makeWater(wtr, mapW, mapD, vertExag, wireframe, id, num, sideView = false) {
  const { x, z } = mapToWorld(Math.max(0, Math.min(1, wtr.cx)), Math.max(0, Math.min(1, wtr.cy)), mapW, mapD, sideView);
  const dM = Number(wtr.depthFromSurfaceM ?? wtr.depth_from_surface_m ?? 0.5);
  const wM = Number(wtr.widthM ?? wtr.width_m ?? wtr.rx * 2 * mapW);
  const lM = Number(wtr.lengthM ?? wtr.length_m ?? wtr.ry * 2 * mapD);
  const sx = Math.max(wM, 0.4);
  const sz = Math.max(lM, 0.4);
  const thickness = Math.max(0.18, Math.min(0.55, sx * 0.08)) * vertExag;
  const y = -(dM * vertExag);

  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.userData.focusId = id;

  const geo = new THREE.CylinderGeometry(sx * 0.5, sx * 0.48, thickness, 28);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x5ec8e0,
      emissive: 0x0a4050,
      emissiveIntensity: 0.28,
      transparent: true,
      opacity: wireframe ? 0.22 : 0.4,
      roughness: 0.4,
      metalness: 0.06,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: !!wireframe,
    })
  );
  mesh.scale.z = Math.max(0.35, sz / Math.max(sx, 0.01));
  group.add(mesh);

  const rim = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({
      color: 0xa8e8f5,
      transparent: true,
      opacity: 0.8,
    })
  );
  rim.scale.z = mesh.scale.z;
  group.add(rim);

  const badge = makeBadgeSprite(num, "#5ec8e0");
  badge.position.set(((num % 3) - 1) * 0.3, thickness * 0.9 + 0.7, 0);
  group.add(badge);

  const detailDepth = dM + (Number(state.structureKotM?.[id]) || 0);
  const area = Number(wtr.areaM2 ?? wtr.area_m2 ?? sx * sz * 0.78);
  const label = wtr.geometry?.label || "olası su";
  const detail = makeDetailSprite(`${num}. Su · olası`, [
    `${label} · ~${area.toFixed(1)} m²`,
    `derinlik ${formatDepthM(detailDepth)}`,
  ]);
  detail.position.set(0, thickness * 0.9 + 1.55, 0);
  group.add(detail);

  state.structureTargets[id] = {
    position: new THREE.Vector3(x, y, z),
    object: group,
    detailLabel: detail,
    radius: Math.max(sx, sz, thickness) * 0.55,
    title: `${num}. Su · olası`,
    depthM: detailDepth,
  };

  return group;
}
