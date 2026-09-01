import * as THREE from "three";
import { state } from "../app/state.js";
import { focusFreeDraw, focusStructure, flyCameraTo } from "./labels.js";
import { isRulerEnabled } from "../ui/mapRuler.js";
import { renderFreeDrawPanel } from "../ui/freeDrawPanel.js";

// 3D sahnede yapıya tıklama → focusStructure (liste kartıyla aynı seçim).
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downPos = null;

// CSV pick tooltip
let _csvPickTooltip = null;
function getCsvTooltip() {
  if (!_csvPickTooltip) _csvPickTooltip = document.getElementById('csv-3d-pick-tooltip');
  return _csvPickTooltip;
}

function findFocusId(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.focusId) return o.userData.focusId;
    o = o.parent;
  }
  return null;
}

// CSV yapı kutusuna tıklanınca — üzerinde etiketlenmiş tespit verisini bul
function findCsvStructInfo(obj) {
  let o = obj;
  while (o) {
    if (o.userData && o.userData.csvStructure) {
      return {
        type: o.userData.csvKind,
        data: o.userData.csvStructure,
        num: o.userData.csvNum,
      };
    }
    o = o.parent;
  }
  return null;
}

function pick(e) {
  if (!state.renderer || !state.camera) return null;
  const el = state.renderer.domElement;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(ndc, state.camera);
  raycaster.params.Line = { threshold: 0.28 };

  // 1) CSV nokta pick (öncelikli — Points nesneleri için special params)
  if (state.csvOverlay?.visible && state.csvOverlay.userData.pointsMesh) {
    const ptsMesh = state.csvOverlay.userData.pointsMesh;
    // Points için threshold ayarla (küp boyutuna göre)
    const poolSize = state.csvOverlay.userData.anomalyStats?.poolSizeM || 30;
    raycaster.params.Points = { threshold: poolSize * 0.025 };
    const ptsHits = raycaster.intersectObject(ptsMesh, false);
    if (ptsHits.length > 0) {
      return { kind: "csv", pointIndex: ptsHits[0].index };
    }
  }

  if (state.structureGroup?.visible) {
    const hits = raycaster.intersectObjects(state.structureGroup.children, true);
    for (const h of hits) {
      const id = findFocusId(h.object);
      if (id) return { kind: "st", id };
    }
  }

  // 1c) CSV yapı kutuları (CSV/HİBRİT modülünde — kutu/silindir + kenar + rozet)
  if (state.csvOverlay?.visible) {
    const csvStructGroup = state.csvOverlay.getObjectByName('csvStructures');
    if (csvStructGroup) {
      const csvHits = raycaster.intersectObjects(csvStructGroup.children, true);
      for (const h of csvHits) {
        const info = findCsvStructInfo(h.object);
        if (info) return { kind: "csvSt", ...info };
      }
    }
  }

  if (state.useFootprintShape && state.freeDrawGroup?.visible) {
    const fdHits = raycaster.intersectObjects(state.freeDrawGroup.children, true);
    for (const h of fdHits) {
      const id = findFocusId(h.object);
      if (id) return { kind: "fd", id };
    }
  }
  return null;
}

function scrollCardIntoView(id) {
  const card = document.querySelector(`.structure-card[data-focus-id="${id}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scrollFdIntoView(id) {
  const item = document.querySelector(`.fd-item[data-fd-id="${id}"]`);
  item?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function onDown(e) {
  if (e.button !== 0) return;
  downPos = { x: e.clientX, y: e.clientY };
}

function onUp(e) {
  if (e.button !== 0 || !downPos) return;
  const dx = e.clientX - downPos.x;
  const dy = e.clientY - downPos.y;
  downPos = null;
  if (dx * dx + dy * dy > 36) return;
  if (isRulerEnabled()) return;
  const hit = pick(e);
  if (!hit) {
    hideCsvPickTooltip();
    hideStructInfoPanel();
    hideCsvStructInfoPanel();
    return;
  }
  e.preventDefault();
  if (hit.kind === "csv") {
    showCsvPickTooltip(e, hit.pointIndex);
    focusCsvPoint(hit.pointIndex);
    return;
  }
  hideCsvPickTooltip();
  if (hit.kind === "csvSt") {
    // CSV yapı kutusu → bilgi paneli + kamera odak
    showCsvStructInfoPanel(hit.type, hit.data, hit.num);
    focusCsvStructure(hit.type, hit.data, hit.num);
    return;
  }
  if (hit.kind === "fd") {
    focusFreeDraw(hit.id);
    renderFreeDrawPanel();
    scrollFdIntoView(hit.id);
    return;
  }
  focusStructure(hit.id);
  scrollCardIntoView(hit.id);
  // Info panelde yapı detayını göster
  showStructInfoPanel(hit.id);
}

function onMove(e) {
  const el = state.renderer?.domElement;
  if (!el) return;
  if (isRulerEnabled()) {
    return;
  }
  const hit = pick(e);
  el.style.cursor = hit ? (hit.kind === "csv" ? "crosshair" : "pointer") : "";
}

// ──────────────────────────────────────────────────────────
// CSV Pick Tooltip
// ──────────────────────────────────────────────────────────

/**
 * Seçili CSV noktasına kamerayı animasyonla odakla.
 */
function focusCsvStructure(type, data, num) {
  if (!data || !state.camera || !state.controls) return;
  const overlay = state.csvOverlay;
  if (!overlay) return;
  const stats = overlay.userData.anomalyStats;
  if (!stats) return;

  // Yapı merkez koordinatını hesapla (havuz-relative)
  let cx = 0, cy = 0, depth = 1;
  if (type === 'oda') {
    cx = Number(data.cx) || 0;
    cy = Number(data.cy) || 0;
    depth = ((Number(data.topFromSurfaceM) || 0) + (Number(data.bottomFromSurfaceM) || 2.5)) / 2;
  } else if (type === 'tunel') {
    cx = ((Number(data.x0) || 0) + (Number(data.x1) || 0)) / 2;
    cy = ((Number(data.y0) || 0) + (Number(data.y1) || 0)) / 2;
    depth = Number(data.floorFromSurfaceM) || 2;
  } else if (type === 'metal') {
    cx = Number(data.cx) || 0;
    cy = Number(data.cy) || 0;
    depth = Number(data.depthFromSurfaceM) || 1;
  }

  const pos = new THREE.Vector3(cx, -depth, cy);
  const size = Math.max(Number(data.widthM) || 2, Number(data.lengthM) || 2, 3);

  // Yapı boyutuna göre kamera ayarı: küçük yapılar daha yakın ve hızlı
  const poolM = stats.poolSizeM || 30;
  const sizeRatio = size / poolM; // yapının havuza oranı
  const isSmall = sizeRatio < 0.15; // havuzun %15'inden küçükse "küçük" sayılır

  const kindLabel = type === 'oda' ? 'Oda' : type === 'tunel' ? 'Tünel' : 'Metal';
  flyCameraTo(pos, size, `${kindLabel} #${num}`,
    isSmall
      ? { duration: 480, distScale: 2.0, heightScale: 0.45 } // küçük: yakın + hızlı
      : { duration: 600, distScale: 2.2, heightScale: 0.50 }, // normal: dengeli
  );
}

function focusCsvPoint(pointIndex) {
  const overlay = state.csvOverlay;
  if (!overlay) return;
  const points = overlay.userData.csvPoints;
  if (!points || pointIndex < 0 || pointIndex >= points.length) return;
  const stats = overlay.userData.anomalyStats;
  if (!stats) return;

  // Noktanın 3D dünyadaki pozisyonunu hesapla (bağımsız eksen ölçekleri)
  const p = points[pointIndex];
  const poolSizeM = stats.poolSizeM || 30;
  const xScale = stats.xScale || stats.scaleFactor || 1;
  const yScale = stats.yScale || stats.scaleFactor || 1;
  const zScale = stats.zScale || stats.scaleFactor || 1;
  const xCenter = (stats.xRange.min + stats.xRange.max) / 2;
  const yCenter = (stats.yRange.min + stats.yRange.max) / 2;
  const zCenter = (stats.zRange.min + stats.zRange.max) / 2;

  const wx = (p.x - xCenter) * xScale;
  const wy = -(p.z - zCenter) * zScale;
  const wz = (p.y - yCenter) * yScale;

  const pos = new THREE.Vector3(wx, wy, wz);
  // Noktalar için yakın ve hızlı odak
  flyCameraTo(pos, poolSizeM * 0.12, `Nokta #${pointIndex + 1} — ${p.magnetic?.toFixed(1)} nT`,
    { duration: 420, distScale: 1.8, heightScale: 0.40 });
}

function showCsvPickTooltip(e, pointIndex) {
  const tip = getCsvTooltip();
  const overlay = state.csvOverlay;
  if (!tip || !overlay) return;

  const points = overlay.userData.csvPoints;
  const bounds = overlay.userData.csvBounds;
  const stats = overlay.userData.anomalyStats;
  if (!points || pointIndex < 0 || pointIndex >= points.length) return;

  const p = points[pointIndex];
  const xM = (p.x / 1e6).toFixed(3);
  const yM = (p.y / 1e6).toFixed(3);
  const zM = (p.z / 1e6).toFixed(3);
  const mag = p.magnetic?.toFixed(1) ?? '—';
  const mean = stats?.mean?.toFixed(1) ?? '—';
  const diff = p.magnetic - (stats?.mean || 0);
  const diffSign = diff > 0 ? '+' : '';
  const magColor = diff > 0 ? '#e85858' : '#5888e8';

  tip.innerHTML = [
    `<strong style="color:#6aee88">◉ Nokta #${pointIndex + 1} / ${points.length}</strong>`,
    `─────`,
    `X: ${xM}m`,
    `Y: ${yM}m`,
    `Z: ${zM}m (derinlik)`,
    `─────`,
    `Manyetik: <span style="color:${magColor};font-weight:bold">${mag} nT</span>`,
    `Ortalama: ${mean} nT`,
    `Fark: <span style="color:${magColor}">${diffSign}${diff.toFixed(1)} nT</span>`,
    `Anomali: ${Math.abs(diff) > (stats?.stddev || 1) * 2 ? '<span style="color:#e8a858">⚡ EVET</span>' : 'Yok'}`,
  ].join('\n');

  tip.style.display = '';
  // Pozisyon (cursor sağ üstünde)
  const tipW = tip.offsetWidth || 220;
  let tx = e.clientX + 16;
  let ty = e.clientY - tip.offsetHeight - 10;
  if (tx + tipW > window.innerWidth - 10) tx = e.clientX - tipW - 16;
  if (ty < 10) ty = e.clientY + 20;
  tip.style.left = tx + 'px';
  tip.style.top = ty + 'px';
}

function hideCsvPickTooltip() {
  const tip = getCsvTooltip();
  if (tip) tip.style.display = 'none';
}

// ──────────────────────────────────────────────────────────
// Yapı Bilgi Paneli (3D pick → InfoPanel)
// ──────────────────────────────────────────────────────────

function getStructInfoPanel() {
  let el = document.getElementById('pick-struct-info');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pick-struct-info';
    el.className = 'struct-info-panel';
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:998;min-width:280px;max-width:360px;display:none;';
    document.body.appendChild(el);
  }
  return el;
}

function findStructureData(id) {
  const surface = state.surfaceState;
  if (!surface?.structures) return null;
  const s = surface.structures;
  const [type, idxStr] = id.split('-');
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx)) return null;
  if (type === 'chamber') return { kind: 'Oda', data: (s.chambers || [])[idx], num: idx };
  if (type === 'tunnel') return { kind: 'Tünel', data: (s.tunnels || [])[idx], num: idx };
  if (type === 'metal') return { kind: 'Metal', data: (s.metals || [])[idx], num: idx };
  if (type === 'water') return { kind: 'Su', data: (s.waters || [])[idx], num: idx };
  return null;
}

function showStructInfoPanel(id) {
  const panel = getStructInfoPanel();
  const info = findStructureData(id);
  if (!info || !info.data) { panel.style.display = 'none'; return; }
  const d = info.data;
  const num = (state.structureTargets[id]?.title || '').match(/^(\d+)/)?.[1] || (info.num + 1);

  const kindClass = info.kind === 'Oda' ? 'oda' : info.kind === 'Tünel' ? 'tunel' : 'metal';
  const conf = Math.round((d.confidence || 0) * 100);
  const confColor = conf >= 80 ? '#4ade80' : conf >= 60 ? '#facc15' : '#f87171';

  let rows = '';
  if (info.kind === 'Oda') {
    const w = (d.widthM ?? d.width_m ?? 0).toFixed(1);
    const l = (d.lengthM ?? d.length_m ?? 0).toFixed(1);
    const h = (d.heightM ?? d.height_m ?? 0).toFixed(2);
    const top = (d.topFromSurfaceM ?? d.top_from_surface_m ?? 0);
    const bot = (d.bottomFromSurfaceM ?? d.bottom_from_surface_m ?? 0);
    rows = `
      <div class="si-row"><span class="si-label">Boyut</span><span class="si-value">${w} × ${l} × ${h} m</span></div>
      <div class="si-row"><span class="si-label">Yüzey → Tavan</span><span class="si-value">${(top * 100).toFixed(0)} cm</span></div>
      <div class="si-row"><span class="si-label">Yüzey → Taban</span><span class="si-value">${(bot * 100).toFixed(0)} cm</span></div>
    `;
  } else if (info.kind === 'Tünel') {
    const h = (d.heightM ?? d.height_m ?? 0).toFixed(2);
    const crown = (d.crownFromSurfaceM ?? d.crown_from_surface_m ?? 0);
    const floor = (d.floorFromSurfaceM ?? d.floor_from_surface_m ?? 0);
    const heading = d.heading || d.direction || '';
    const deg = Math.round(d.bearingDeg ?? d.bearing_deg ?? 0);
    rows = `
      <div class="si-row"><span class="si-label">Yön</span><span class="si-value">${heading} (${deg}°)</span></div>
      <div class="si-row"><span class="si-label">İç yükseklik</span><span class="si-value">${h} m</span></div>
      <div class="si-row"><span class="si-label">Tavan</span><span class="si-value">${(crown * 100).toFixed(0)} cm</span></div>
      <div class="si-row"><span class="si-label">Taban</span><span class="si-value">${(floor * 100).toFixed(0)} cm</span></div>
    `;
  } else if (info.kind === 'Metal') {
    const strength = Math.round((d.fieldStrength ?? d.field_strength ?? d.intensity ?? 0) * 100);
    const depth = (d.depthFromSurfaceM ?? d.depth_from_surface_m ?? 0);
    const guess = d.metalGuess || d.metal_guess || '';
    rows = `
      <div class="si-row"><span class="si-label">Derinlik</span><span class="si-value">${(depth * 100).toFixed(0)} cm</span></div>
      <div class="si-row"><span class="si-label">Güç</span><span class="si-value">${strength}%</span></div>
      ${guess ? `<div class="si-row"><span class="si-label">Tahmini</span><span class="si-value">${guess}</span></div>` : ''}
    `;
  }

  // Yakın yapılar
  const targets = Object.entries(state.structureTargets || {});
  const myPos = state.structureTargets[id]?.position;
  let nearbyHtml = '';
  if (myPos && targets.length > 1) {
    const nearby = targets
      .filter(([k]) => k !== id)
      .map(([k, t]) => ({ id: k, dist: t.position ? myPos.distanceTo(t.position) : Infinity, title: t.title }))
      .filter(n => n.dist < 8)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);
    if (nearby.length > 0) {
      nearbyHtml = `<div class="si-nearby">Yakın: ${nearby.map(n => `${n.title} (${n.dist.toFixed(1)}m)`).join(' · ')}</div>`;
    }
  }

  panel.innerHTML = `
    <div class="si-header">
      <span class="si-badge ${kindClass}">${info.kind}</span>
      <span class="si-title">${num}. ${info.kind}</span>
      <button class="si-close" onclick="this.closest('.struct-info-panel').style.display='none'">✕</button>
    </div>
    <div class="si-row"><span class="si-label">Güven</span><span class="si-value" style="color:${confColor}">${conf}%</span></div>
    ${rows}
    ${nearbyHtml}
  `;
  panel.style.display = '';
}

function hideStructInfoPanel() {
  const el = document.getElementById('pick-struct-info');
  if (el) el.style.display = 'none';
}

// ── CSV Yapı Bilgi Paneli (3D pick → csvPanel.renderCsvStructInfo) ──

async function showCsvStructInfoPanel(type, data, num) {
  if (!data) return;
  try {
    const { renderCsvStructInfo } = await import("../ui/csvPanel.js");
    renderCsvStructInfo({ type, data: data._num != null ? data : { ...data, _num: num }, dist: null });
  } catch (e) {
    console.warn("[Pick] CSV yapı paneli açılamadı:", e);
  }
}

function hideCsvStructInfoPanel() {
  const el = document.getElementById('csv-struct-info');
  if (el) el.style.display = 'none';
}

export function bindStructurePicking() {
  const el = state.renderer?.domElement;
  if (!el || el.dataset.pickBound === "1") return;
  el.dataset.pickBound = "1";
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointermove", onMove);
}
