/**
 * hintEngine.js — Tek motor: DTA (image) ve CSV verisinden tespit edilen
 * yapıları 3D haritada ipucu olarak gösterir.
 *
 * Kullanım:
 *   import { showHints, clearHints } from './hintEngine.js';
 *   showHints(scene, structures, { mapW, mapD, vertExag });
 *   clearHints(scene);
 */

import * as THREE from 'three';
import { mapToWorld } from './coords.js';
import { invalidate } from './scene.js';

// ── Görünürlük kontrolü (kullanıcı açıp kapatabilir) ──
// hintLayer her zaman tek bir grup olduğu için kayıt dizisi küçüktür.
let hintsVisible = true;
const hintGroups = [];

/**
 * 3D ipucu toplarını göster/gizle (tüm modüllerde geçerli).
 * Görünürlük ayrıca kaynağın modülüne göre de kısıtlanır (bkz. applyHintVisibility).
 */
export function setHintsVisible(visible) {
  hintsVisible = !!visible;
  applyHintVisibility();
}

export function isHintsVisible() {
  return hintsVisible;
}

/**
 * Her ipucu grubunu kaynağına göre gösterir:
 *   hint-dta → yalnız GÖRÜNTÜ / HİBRİT
 *   hint-csv → yalnız CSV / HİBRİT
 * Ayrıca kullanıcının aç/kapa tercihine uyar.
 */
function applyHintVisibility() {
  const activeMod = document.querySelector("#votex-ray .vr-btn.active")?.dataset?.mod || "image";
  const isImageLike = activeMod === "image" || activeMod === "hybrid";
  const isCsvLike = activeMod === "csv" || activeMod === "hybrid";
  for (const g of hintGroups) {
    if (!g.parent) continue;
    const src = g.userData?.hintSource || "dta";
    const inModule = src === "csv" ? isCsvLike : isImageLike;
    g.visible = hintsVisible && inModule;
  }
  invalidate();
}

// ── Renk şeması (kontrastlı — heatmap'ten net ayrılacak) ──
const COLORS = {
  room:     { high: 0x00eeff, mid: 0x00bbff, low: 0x0088dd },  // parlak cyan
  tomb:     { high: 0xcc66ff, mid: 0xaa44dd, low: 0x8833aa },  // mor
  shaft:    { high: 0xffcc00, mid: 0xffaa00, low: 0xff8800 },  // altın
  tunnel:   { high: 0xffdd00, mid: 0xffbb00, low: 0xff9900 },  // parlak sarı
  metal:    { high: 0xff3300, mid: 0xff6600, low: 0xff9900 },  // kırmızı-turuncu
  default:  { high: 0x00eeff, mid: 0x00bbff, low: 0x0088dd },
};

function confidenceColor(kind, confidence) {
  const palette = COLORS[kind] || COLORS.default;
  if (confidence >= 0.8) return palette.high;
  if (confidence >= 0.6) return palette.mid;
  return palette.low;
}

// ── Yapı → İpucu dönüşümü ──
function structuresToHints(structures) {
  if (!structures) return [];
  const hints = [];
  const chambers = structures.chambers || [];
  const tunnels = structures.tunnels || [];
  const metals = structures.metals || [];

  chambers.forEach((ch, i) => {
    if (ch.kind === 'cavity') return;
    const kind = ch.kind === 'tomb' ? 'tomb'
               : ch.kind === 'shaft' ? 'shaft'
               : 'room';
    hints.push({
      kind,
      cx: Math.max(0, Math.min(1, ch.cx)), cy: Math.max(0, Math.min(1, ch.cy)), rx: ch.rx, ry: ch.ry,
      confidence: ch.confidence || 0.5,
      depth: ch.top_from_surface_m || ch.topFromSurfaceM || 0,
      height: ch.height_m || ch.heightM || 0,
      width: ch.width_m || ch.widthM || 0,
      length: ch.length_m || ch.lengthM || 0,
      label: ch.geometry?.label || `${ch.kind} #${i + 1}`,
      sourceIdx: i,
    });
  });

  tunnels.forEach((t, i) => {
    // x0/y0/x1/y1 0-1 dışında olabilir — orta noktayı da kıskaçla
    const cx = Math.max(0, Math.min(1, (t.x0 + t.x1) * 0.5));
    const cy = Math.max(0, Math.min(1, (t.y0 + t.y1) * 0.5));
    hints.push({
      kind: 'tunnel',
      cx, cy,
      rx: Math.abs(t.x1 - t.x0) * 0.5,
      ry: Math.abs(t.y1 - t.y0) * 0.5,
      confidence: t.confidence || 0.5,
      depth: t.crown_from_surface_m || t.crownFromSurfaceM || 0,
      height: t.height_m || t.heightM || 0,
      width: t.width_m || t.widthM || 0,
      heading: t.heading || '',
      label: t.geometry?.label || `Tünel #${i + 1}`,
      sourceIdx: i,
    });
  });

  metals.forEach((m, i) => {
    hints.push({
      kind: 'metal',
      cx: Math.max(0, Math.min(1, m.cx)), cy: Math.max(0, Math.min(1, m.cy)), rx: m.rx, ry: m.ry,
      confidence: m.confidence || 0.5,
      depth: m.depth_from_surface_m || m.depthFromSurfaceM || 0,
      metalGuess: m.metal_guess || m.metalGuess || '',
      label: m.metal_guess
        ? `${m.metal_guess} #${i + 1}`
        : `Metal #${i + 1}`,
      sourceIdx: i,
    });
  });

  return hints;
}

// ── 3D sahneye ipuçlarını ekle ──
function createHintMeshes(hints, mapW, mapD, vertExag, source) {
  const group = new THREE.Group();
  group.name = 'hintLayer';
  group.userData.votexLayer = 'hint';

  const exag = Math.max(Number(vertExag) || 1, 0.15);
  const isCsv = source === 'csv';

  hints.forEach((hint, i) => {
    // Koordinat sistemi: DTA yapıları 0-1 aralığında (normalize), CSV yapıları metre cinsinde.
    // Kaynak etiketiyle karar ver — 0-1 sezgisi CSV havuz ortasındaki yapıları yanlış okurdu.
    let x, z;
    if (isCsv) {
      // CSV — zaten metre cinsinden; harita sınırına kıskaçla (harita dışına taşmasın)
      x = Math.max(-mapW / 2, Math.min(mapW / 2, hint.cx));
      z = Math.max(-mapD / 2, Math.min(mapD / 2, hint.cy));
    } else {
      // DTA (image) — normalize 0-1 → metre
      // cx/cy her zaman 0-1 arasında olmayabilir (geniş yapılar, tünel baş/son)
      const cxClamped = Math.max(0, Math.min(1, hint.cx));
      const cyClamped = Math.max(0, Math.min(1, hint.cy));
      const w = mapToWorld(cxClamped, cyClamped, mapW, mapD);
      x = w.x;
      z = w.z;
    }
    // Derinlik: metre cinsinden derinlik → negatif Y
    const depthM = hint.depth || 0;
    const y = -depthM * exag;

    const color = confidenceColor(hint.kind, hint.confidence);

    // ── Nokta (küçük küre) — boyutu normal, haritayı kapatmaz ──
    const ptR = hint.kind === 'room' ? 0.18 : hint.kind === 'tunnel' ? 0.15 : 0.13;
    const sphereGeo = new THREE.SphereGeometry(ptR, 12, 8);
    const sphereMat = new THREE.MeshPhongMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(x, y, z);
    sphere.userData = {
      isHint: true,
      hintKind: hint.kind,
      hintLabel: hint.label,
      hintConfidence: hint.confidence,
      hintIdx: i,
    };
    group.add(sphere);

    // ── Etiket (sprite) — normal boyutta, noktanın hemen üstünde ──
    const canvas = document.createElement('canvas');
    canvas.width = 260;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 260, 32, 6);
    ctx.fill();
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const shortLabel = hint.label.length > 24 ? hint.label.substring(0, 21) + '...' : hint.label;
    ctx.fillText(`${shortLabel} · %${(hint.confidence * 100).toFixed(0)} · ${depthM.toFixed(1)}m`, 130, 16);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(x, y + 0.32, z);
    sprite.scale.set(1.7, 0.21, 1);
    group.add(sprite);
  });

  return group;
}

// ── PUBLIC API ──

/**
 * Sahneye ipuçlarını ekle (eskiyi otomatik temizler).
 * @param {THREE.Scene} scene
 * @param {Object} structures - { chambers, tunnels, metals }
 * @param {Object} opts - { mapW, mapD, vertExag }
 * @returns {THREE.Group|null}
 */
export function showHints(scene, structures, opts = {}) {
  clearHints(scene);
  if (!structures || !scene) return null;

  const hints = structuresToHints(structures);
  if (hints.length === 0) return null;

  const mapW = opts.mapW || 30;
  const mapD = opts.mapD || 30;
  const vertExag = opts.vertExag || 1;
  // Kaynak: DTA (image) ipuçları yalnız GÖRÜNTÜ/HİBRİT; CSV ipuçları yalnız CSV/HİBRİT.
  const source = opts.source === "csv" ? "csv" : "dta";

  const group = createHintMeshes(hints, mapW, mapD, vertExag, source);
  group.userData.hintSource = source;
  group.userData.votexLayer = source === "csv" ? "hint-csv" : "hint-dta";
  scene.add(group);
  hintGroups.push(group);
  applyHintVisibility();
  invalidate();
  console.log(`[Hints] ${hints.length} ipucu eklendi (${source} · ${hints.filter(h=>h.kind==='room').length} oda, ${hints.filter(h=>h.kind==='tunnel').length} tünel, ${hints.filter(h=>h.kind==='metal').length} metal)`);
  return group;
}

/**
 * İpucu katmanını temizle.
 */
export function clearHints(scene) {
  const old = scene.getObjectByName('hintLayer');
  if (old) {
    scene.remove(old);
    const idx = hintGroups.indexOf(old);
    if (idx >= 0) hintGroups.splice(idx, 1);
    old.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    invalidate();
  }
}
