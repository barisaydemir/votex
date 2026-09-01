import * as THREE from "three";
import { state } from "../../app/state.js";
import { colorByDepth, edgeColorByDepth, formatDepthM } from "../colors.js";
import { makeBadgeSprite, makeDetailSprite } from "../labels.js";
import { mapToWorld } from "../coords.js";
import { applyTierGhost, makeTierLabel } from "./tierGhost.js";
import { t } from "../../i18n/index.js";

/** Birim kemer: taban düz, üst yarım daire. */
function unitVaultShape() {
  const shape = new THREE.Shape();
  const hw = 0.5;
  shape.moveTo(-hw, 0);
  shape.lineTo(hw, 0);
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI;
    shape.lineTo(Math.cos(a) * hw, Math.sin(a));
  }
  return shape;
}

/**
 * Tünel: üstü kemerli D-profil; uçlar path (x0,y0)–(x1,y1).
 */
export function makeTunnel(t, mapW, mapD, vertExag, wireframe, id, num, sideView = false) {
  const floorM = Number(t.floorFromSurfaceM ?? t.floor_from_surface_m ?? 2);
  const crownM = Number(t.crownFromSurfaceM ?? t.crown_from_surface_m ?? 0.5);
  const spanM = Math.max(Math.abs(floorM - crownM), 0.4);
  const hM0 = Math.max(Number(t.heightM ?? t.height_m ?? spanM), 0.4);
  // x0/y0/x1/y1 0-1 dışında olabilir — harita sınırlarıyla kıskaçla
  const x0c = Math.max(0, Math.min(1, t.x0 || 0));
  const y0c = Math.max(0, Math.min(1, t.y0 || 0));
  const x1c = Math.max(0, Math.min(1, t.x1 || 0));
  const y1c = Math.max(0, Math.min(1, t.y1 || 0));
  const a = mapToWorld(x0c, y0c, mapW, mapD, sideView);
  const b = mapToWorld(x1c, y1c, mapW, mapD, sideView);
  const hM = hM0;
  const wM = Number(t.widthM ?? t.width_m ?? hM);



  // Tünel gerçek derinliğinde: kemer üstü crownM, taban floorM derinliğinde
  const floorY = -Math.max(floorM, crownM + 0.15) * vertExag;
  const heightDraw = hM * vertExag;
  const widthDraw = Math.max(wM, 0.5);

  // Aspect ratio kontrolü — kısa tünel için basit koridor çiz
  const dx = (t.x1 || 0) - (t.x0 || 0);
  const dz = (t.y1 || 0) - (t.y0 || 0);
  const tunnelLen = Math.hypot(dx, dz);
  const aspect = tunnelLen / (wM || 1);
  const isShortTunnel = aspect < 2.5;

  const p0 = new THREE.Vector3(a.x, floorY, a.z);
  const p1 = new THREE.Vector3(b.x, floorY, b.z);
  const dir = new THREE.Vector3().subVectors(p1, p0);
  let len = dir.length();
  // Kısa segmentleri atma — yan kesitte normalize mesafe küçük kalabiliyor
  if (len < 0.08) {
    const bump = 0.45;
    if (dir.lengthSq() < 1e-10) {
      p1.x = p0.x + bump;
    } else {
      dir.normalize().multiplyScalar(bump);
      p1.copy(p0).add(dir);
    }
    len = bump;
  } else if (len < 0.35) {
    const scale = 0.35 / len;
    const midPt = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    p0.sub(midPt).multiplyScalar(scale).add(midPt);
    p1.sub(midPt).multiplyScalar(scale).add(midPt);
    len = 0.35;
  }

  const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
  const wallColor = colorByDepth(Math.min(crownM, floorM), "tunnel");
  const edgeColor = edgeColorByDepth(Math.min(crownM, floorM), "tunnel");

  const zAxis = new THREE.Vector3().subVectors(p1, p0).normalize();
  let xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis);
  if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

  const group = new THREE.Group();
  group.userData.focusId = id;
  group.userData.type = "tunnel";

  if (isShortTunnel) {
    // ── Kısa tünel: basit koridor çizgisi (zorlama vault yerine) ──
    const corridorH = heightDraw * 0.6;
    const corridorW = widthDraw * 0.8;
    const corridorGeo = new THREE.BoxGeometry(corridorW, corridorH, len);
    const corridorMat = new THREE.MeshStandardMaterial({
      color: wallColor, transparent: true, opacity: 0.45,
      roughness: 0.7, side: THREE.DoubleSide, depthWrite: false,
    });
    const corridor = new THREE.Mesh(corridorGeo, corridorMat);
    corridor.position.copy(mid);
    corridor.quaternion.copy(quat);
    group.add(corridor);

    // Kenar çizgisi
    const edgeLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(corridorGeo),
      new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.7 })
    );
    edgeLine.position.copy(mid);
    edgeLine.quaternion.copy(quat);
    group.add(edgeLine);
  } else {
    // ── Uzun tünel: vault/kemer şekli ──
    const shape = unitVaultShape();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: len,
      bevelEnabled: false,
      curveSegments: 28,
      steps: Math.max(1, Math.floor(len / 1.2)),
    });
    geo.translate(0, 0, -len * 0.5);
    geo.scale(widthDraw, heightDraw, 1);

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: wallColor,
      transparent: true,
      opacity: wireframe ? 0.35 : sideView ? 0.5 : 0.55,
      roughness: 0.7,
      metalness: 0.05,
      side: THREE.DoubleSide,
      wireframe: !!wireframe,
      depthWrite: false,
    })
  );
  mesh.position.copy(mid);
  mesh.quaternion.copy(quat);
  group.add(mesh);

  const inner = new THREE.Mesh(
    geo.clone(),
    new THREE.MeshStandardMaterial({
      color: 0x0a1216,
      transparent: true,
      opacity: 0.5,
      roughness: 0.95,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  inner.position.copy(mid);
  inner.position.y += heightDraw * 0.02;
  inner.quaternion.copy(quat);
  group.add(inner);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(widthDraw * 0.98, len * 0.98),
    new THREE.MeshStandardMaterial({
      color: 0x1a3038,
      transparent: true,
      opacity: 0.55,
      roughness: 0.95,
      depthWrite: false,
    })
  );
  floor.position.copy(mid);
  floor.position.y += 0.02;
  floor.quaternion.copy(quat);
  floor.rotateX(-Math.PI / 2);
  group.add(floor);
  } // else (uzun tünel kemer bloğu sonu)

  // Kemer kaburga çerçeveleri
  const frameMat = new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.8 });
  const hw = widthDraw * 0.5;
  for (let i = 1; i <= 4; i++) {
    const tt = i / 5;
    const pos = new THREE.Vector3().lerpVectors(p0, p1, tt);
    const pts = [new THREE.Vector3(-hw, 0, 0)];
    for (let s = 0; s <= 24; s++) {
      const ang = (s / 24) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(ang) * hw, Math.sin(ang) * heightDraw, 0));
    }
    pts.push(new THREE.Vector3(-hw, 0, 0));
    const frame = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), frameMat);
    frame.position.copy(pos);
    frame.quaternion.copy(quat);
    group.add(frame);
  }

  const direction = t.direction || t.heading || "?";
  const bearing = Math.round(t.bearingDeg ?? t.bearing_deg ?? 0);
  const heading = t.heading || "";
  const linkLabel = t.geometry?.label || t.geometry?.Label || "";
  const isLink = String(linkLabel).toLowerCase().includes("bağlantı");
  const title = isLink ? `${num}. Bağlantı` : `${num}. Tünel · ${direction}`;

  const badge = makeBadgeSprite(num, isLink ? "#9ec8a8" : "#4ec0d4");
  badge.position.copy(mid);
  badge.position.y += heightDraw + 1.1;
  badge.position.x += ((num % 3) - 1) * 0.4;
  group.add(badge);

  const kotM = Number(state.structureKotM?.[id]) || 0;
  const coverShow = Math.min(crownM, floorM) + kotM;
  const detail = makeDetailSprite(title, [
    `merkez noktası: ${mid.x.toFixed(1)}, ${(-coverShow).toFixed(1)}, ${mid.z.toFixed(1)} m`,
    isLink ? `oda bağlantısı · ${heading} ${bearing}°` : `${heading} ${bearing}° · ${widthDraw.toFixed(1)}×${hM.toFixed(2)} m`,
  ]);
  detail.position.copy(mid);
  detail.position.y += heightDraw + 2.4;
  group.add(detail);

  const coverLen = Math.max(coverShow, 0) * vertExag;
  if (coverLen > 0.05) {
    group.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(mid.x + widthDraw * 0.55, kotM * vertExag + 0.02, mid.z),
        coverLen,
        0xa8e0a0,
        0.28,
        0.16
      )
    );
  }
  group.add(
    new THREE.ArrowHelper(
      zAxis,
      mid.clone().add(new THREE.Vector3(0, heightDraw * 0.3, 0)),
      Math.min(len * 0.35, 3.2),
      0xffd27a,
      0.4,
      0.25
    )
  );

  state.structureTargets[id] = {
    position: mid.clone().add(new THREE.Vector3(0, heightDraw * 0.5, 0)),
    object: group,
    detailLabel: detail,
    radius: Math.max(widthDraw, heightDraw, len * 0.25, 2),
    title,
    depthM: coverShow,
  };

  const tier = Number(t.tier ?? 0);
  if (tier > 0) {
    applyTierGhost(group, tier);
    const tl = makeTierLabel(tier, t.depthEstimateM ?? t.depth_estimate_m);
    if (tl) {
      tl.position.copy(mid);
      tl.position.y += heightDraw + 2.6;
      group.add(tl);
    }
  }

  return group;
}

export function tunnelVaultShape(halfW, height) {
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI;
    shape.lineTo(Math.cos(a) * halfW, Math.sin(a) * height);
  }
  return shape;
}
