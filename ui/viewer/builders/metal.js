import * as THREE from "three";
import { state } from "../../app/state.js";
import { colorByDepth, formatDepthM } from "../colors.js";
import { makeBadgeSprite, makeDetailSprite } from "../labels.js";
import { mapToWorld } from "../coords.js";
import { applyTierGhost, makeTierLabel } from "./tierGhost.js";
import { t } from "../../i18n/index.js";
import { metalCueTitle } from "../../i18n/labels.js";

function cueTitleOf(m) {
  return metalCueTitle(m, { short: true });
}

function fieldMat(color, opacity, wireframe) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: 0x4a1208,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: wireframe ? Math.min(opacity, 0.28) : opacity,
    roughness: 0.85,
    metalness: 0.15,
    depthWrite: false,
    side: THREE.DoubleSide,
    wireframe: !!wireframe,
  });
}

/** Kırmızı = ani renk geçişi / yapı içi dolgu — kendi başına yapı değil. */
export function makeMetal(m, mapW, mapD, vertExag, wireframe, id, num, sideView = false) {
  const host = m.hostKind ?? m.host_kind ?? "";
  const inside = !!(m.insideChamber ?? m.inside_chamber);
  // Host yoksa bile çiz — her metal haritada görünsün
  // if (!host || !inside) return null;  // eskisi: sadece chamber içi

  const { x, z } = mapToWorld(Math.max(0, Math.min(1, m.cx)), Math.max(0, Math.min(1, m.cy)), mapW, mapD, sideView);
  const dM = m.depthFromSurfaceM ?? m.depth_from_surface_m ?? 1;
  const wM = Math.max(m.widthM ?? m.width_m ?? 1.2, 0.4);
  const lM = Math.max(m.lengthM ?? m.length_m ?? wM, 0.4);
  const spreadM = Math.max(m.spreadM ?? m.spread_m ?? Math.max(wM, lM) * 0.5, 0.3);
  const strength = Number(m.fieldStrength ?? m.field_strength ?? m.intensity ?? 0.5);
  const plumeH = Math.max(m.plumeHeightM ?? m.plume_height_m ?? 0.5, 0.2);
  const bearing = ((m.bearingDeg ?? m.bearing_deg ?? 0) * Math.PI) / 180;
  const hostTitle = cueTitleOf(m);
  const baseColor = colorByDepth(dM, "metal");
  const opCore = Math.min(0.7, Math.max(0.3, 0.35 + strength * 0.35));

  const group = new THREE.Group();
  group.userData.focusId = id;
  group.userData.type = "metal";

  const applyOrient = () => {
    // Yan: döndürme yok — kırmızı haritadaki ayakizinin altında kalsın
    if (sideView) return;
    if (Math.abs(bearing) > 0.02) {
      group.rotation.y = -bearing;
    }
  };

  if (host === "shaft") {
    const h = plumeH * vertExag;
    const r = Math.max(Math.min(wM, lM) * 0.5, 0.25);
    const y = -(dM * vertExag);
    group.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.95, r * 1.05, h, 20, 1, true),
        fieldMat(baseColor, opCore * 0.85, wireframe)
      )
    );
    group.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(r * 1.25, r * 1.35, h * 0.92, 16, 1, true),
        fieldMat(0xc04028, opCore * 0.35, false)
      )
    );
    group.position.set(x, y, z);
    applyOrient();
  } else if (host === "tunnel") {
    const h = plumeH * vertExag;
    const along = Math.max(lM, 0.35);
    const cross = Math.max(wM, 0.3);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(along, h, cross), fieldMat(baseColor, opCore * 0.72, wireframe)));
    group.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(along * 1.05, h * 0.7, cross * 1.05),
        fieldMat(0xc04028, opCore * (sideView ? 0.32 : 0.28), false)
      )
    );
    group.position.set(x, -(dM * vertExag), z);
    applyOrient();
  } else if (host === "room" || host === "tomb") {
    const h = plumeH * vertExag;
    group.add(new THREE.Mesh(new THREE.BoxGeometry(wM, h, lM), fieldMat(baseColor, opCore * 0.7, wireframe)));
    group.add(
      new THREE.Mesh(new THREE.BoxGeometry(wM * 1.1, h * 0.7, lM * 1.1), fieldMat(0xb83820, opCore * 0.28, false))
    );
    group.position.set(x, -(dM * vertExag), z);
    applyOrient();
  } else {
    // Hostsuz metal — basit küp olarak çiz
    const h = Math.max(plumeH * vertExag, 0.5);
    const s = Math.max(wM, lM, 0.6);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(s, h, s), fieldMat(baseColor, opCore, wireframe)));
    group.add(new THREE.Mesh(
      new THREE.BoxGeometry(s * 1.15, h * 0.7, s * 1.15),
      fieldMat(0xc04028, opCore * 0.25, false)
    ));
    group.position.set(x, -(dM * vertExag), z);
    applyOrient();
  }

  const title = `${num}. ${hostTitle || 'Metal'}`;
  const badge = makeBadgeSprite(num, "#d4a060");
  const badgeY = plumeH * vertExag * 0.55 + 1.0;
  badge.position.set(((num % 3) - 1) * 0.35, badgeY, ((num % 2) * 2 - 1) * 0.25);
  group.add(badge);

  const detailDepth = dM + (Number(state.structureKotM?.[id]) || 0);
  const gpsLines = [];
  try {
    if (window.__gpsMod?.getGpsState()?.active) {
      const gps = window.__gpsMod.localToGps(x, z);
      if (gps) gpsLines.push(`📍 ${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E`);
    }
  } catch(e) {}
  const detail = makeDetailSprite(title, [
    `merkez noktası: ${x.toFixed(2)}, ${(-dM).toFixed(2)}, ${z.toFixed(2)} m`,
    ...gpsLines,
    `derinlik ${formatDepthM(detailDepth)} · genişlik ${wM.toFixed(1)} m`,
    t("msg.fill3d", { pct: Math.round(strength * 100) }) + (hostTitle ? ` · ${hostTitle}` : ""),
  ]);
  detail.position.set(0, badgeY + 1.1, 0);
  group.add(detail);

  state.structureTargets[id] = {
    position: new THREE.Vector3(x, -(dM * vertExag), z),
    object: group,
    detailLabel: detail,
    radius: Math.max(wM, lM, spreadM, plumeH) * 0.55,
    title,
    depthM: detailDepth,
  };

  const tier = Number(m.tier ?? 0);
  if (tier > 0) {
    applyTierGhost(group, tier);
    const tl = makeTierLabel(tier, m.depthEstimateM ?? m.depth_estimate_m);
    if (tl) {
      tl.position.set(0, badgeY + 1.7, 0);
      group.add(tl);
    }
  }

  return group;
}

/** 3D mesh yoksa bile (yapı dışı alan) kameranın gideceği nokta. */
export function ensureMetalFocusTarget(m, id, mapW, mapD, vertExag, sideView = false) {
  if (!m || !id || state.structureTargets[id]) return;    const { x, z } = mapToWorld(Math.max(0, Math.min(1, m.cx)), Math.max(0, Math.min(1, m.cy)), mapW, mapD, sideView);
    const dM = Number(m.depthFromSurfaceM ?? m.depth_from_surface_m ?? 1);
    const wM = Math.max(m.widthM ?? m.width_m ?? 1.2, 0.4);
  const lM = Math.max(m.lengthM ?? m.length_m ?? wM, 0.4);
  const spreadM = Math.max(m.spreadM ?? m.spread_m ?? Math.max(wM, lM) * 0.5, 0.3);
  const title = metalCueTitle(m, { short: true });
  state.structureTargets[id] = {
    position: new THREE.Vector3(x, -(dM * Math.max(Number(vertExag) || 1, 0.15)), z),
    object: null,
    radius: Math.max(wM, lM, spreadM, 1.6) * 0.6,
    title,
    depthM: dM + (Number(state.structureKotM?.[id]) || 0),
  };
}
