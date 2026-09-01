/**
 * hybridHints.js — Hibrit İpucu Sistemi
 *
 * Çapraz doğrulama sonuçlarını 3D haritaya geri besler.
 * Konsensüs tespitleri (her iki kaynakta da güçlü destek) özel renk ile
 * 3D sahneye eklenir.
 *
 * Renk şeması:
 *   🟣 Mor/Kırmızı  → Image + CSV uyumlu (en yüksek güven)
 *   🟡 Altın/Sarı   → Sadece image'da güçlü sinyal
 *   🔵 Mavi         → Sadece CSV'de güçlü tespit
 *   ⚪ Gri          → Düşük güvenli
 */

import * as THREE from 'three';
import { crossValidate, findConsensusDetections } from './crossValidation.js';
import { invalidate } from '../viewer/scene.js';

// ── Sabitler ──

/** İpucu türleri ve renkleri */
export const HINT_TYPES = {
  consensus: { color: 0x9b5cf6, label: 'Konsensüs', priority: 1 },    // Mor
  imageStrong: { color: 0xf59e0b, label: 'Image Güçlü', priority: 2 }, // Altın
  csvStrong: { color: 0x3b82f6, label: 'CSV Güçlü', priority: 3 },    // Mavi
  uncertain: { color: 0x6b7280, label: 'Belirsiz', priority: 4 },     // Gri
};

/** İpucu boyutu (metre) */
export const HINT_SIZES = {
  consensus: 1.2,
  imageStrong: 0.9,
  csvStrong: 0.9,
  uncertain: 0.6,
};

// ── İpucu Üretimi ──

/**
 * Çapraz doğrulama sonuçlarından ipuçları üret.
 *
 * @param {Object} crossValResult - crossValidate çıktısı
 * @param {Object} options
 * @param {number} [options.minConfidence=0.5] - Minimum güven eşiği
 * @param {number} [options.poolSizeM=30] - Havuz boyutu (metre)
 * @returns {Array} İpucu listesi
 */
export function generateHints(crossValResult, options = {}) {
  const { minConfidence = 0.5, poolSizeM = 30 } = options;

  if (!crossValResult) return [];

  const hints = [];
  const halfPool = poolSizeM / 2;

  // 1) Konsensüs tespitleri (her iki kaynakta da olan)
  const consensus = findConsensusDetections(crossValResult.matches, minConfidence);
  for (const det of consensus) {
    hints.push({
      type: 'consensus',
      x: det.x,
      y: det.y,
      depth: det.depth || 5,
      magnetic: det.magnetic || 0,
      confidence: det.confidence,
      source: 'cross-validation',
      label: `${HINT_TYPES.consensus.label} · ${(det.confidence * 100).toFixed(0)}%`,
      data: det,
    });
  }

  // 2) Sadece image'da güçlü sinyaller
  for (const det of crossValResult.unmatchedImage) {
    if ((det.confidence || 0) >= minConfidence && Math.abs(det.magnetic || 0) > 200) {
      hints.push({
        type: 'imageStrong',
        x: det.x,
        y: det.y,
        depth: det.depth || 5,
        magnetic: det.magnetic || 0,
        confidence: (det.confidence || 0.5) * 0.8, // Güven düşür
        source: 'image-only',
        label: `${HINT_TYPES.imageStrong.label} · ${(det.magnetic || 0).toFixed(0)}nT`,
        data: det,
      });
    }
  }

  // 3) Sadece CSV'de güçlü tespitler
  for (const det of crossValResult.unmatchedCsv) {
    if ((det.confidence || 0) >= minConfidence && Math.abs(det.magnetic || 0) > 200) {
      hints.push({
        type: 'csvStrong',
        x: det.x,
        y: det.y,
        depth: det.depth || 5,
        magnetic: det.magnetic || 0,
        confidence: (det.confidence || 0.5) * 0.85,
        source: 'csv-only',
        label: `${HINT_TYPES.csvStrong.label} · ${(det.magnetic || 0).toFixed(0)}nT`,
        data: det,
      });
    }
  }

  // 4) Uyumsuz eşleşmeler (düşük güvenli)
  for (const m of crossValResult.mismatches) {
    if (m.confidence >= minConfidence * 0.5) {
      hints.push({
        type: 'uncertain',
        x: (m.image.x + m.csv.x) / 2,
        y: (m.image.y + m.csv.y) / 2,
        depth: ((m.image.depth || 5) + (m.csv.depth || 5)) / 2,
        magnetic: ((m.image.magnetic || 0) + (m.csv.magnetic || 0)) / 2,
        confidence: m.confidence * 0.5,
        source: 'mismatch',
        label: `Belirsiz · fark: ${m.depthDiff.toFixed(1)}m`,
        data: m,
      });
    }
  }

  // Öncelik sırasına göre sırala (konsensüs üstte)
  hints.sort((a, b) => {
    const pa = HINT_TYPES[a.type]?.priority || 99;
    const pb = HINT_TYPES[b.type]?.priority || 99;
    return pa - pb;
  });

  console.log(`[HybridHints] ${hints.length} ipucu üretildi: ${hints.filter(h => h.type === 'consensus').length} konsensüs, ${hints.filter(h => h.type === 'imageStrong').length} image, ${hints.filter(h => h.type === 'csvStrong').length} csv`);

  return hints;
}

// ── 3D Görselleştirme ──

/**
 * İpuçlarını 3D sahneye ekle.
 * Her ipucu için küre + etiket + derinlik çizgisi çizer.
 *
 * @param {THREE.Scene} scene
 * @param {Array} hints - generateHints çıktısı
 * @param {Object} options
 * @param {number} [options.poolSizeM=30]
 * @param {number} [options.yScale=1] - Y ekseni ölçek
 * @returns {THREE.Group} İpuçları içeren grup
 */
export function addHintsToScene(scene, hints, options = {}) {
  const { poolSizeM = 30, yScale = 1 } = options;
  const halfPool = poolSizeM / 2;

  const group = new THREE.Group();
  group.name = 'hybridHints';
  group.userData.votexLayer = 'hybrid'; // yalnız HİBRİT modülünde görünür

  for (const hint of hints) {
    const hintType = HINT_TYPES[hint.type] || HINT_TYPES.uncertain;
    const size = HINT_SIZES[hint.type] || 0.6;

    // Havuz-relative koordinatlar
    const worldX = hint.x;
    const worldZ = hint.y; // Y → Z (3D koordinat sistemi)
    const worldY = -(hint.depth || 5) * yScale; // Derinlik → negatif Y

    // 1) Küre (ana marker)
    const sphereGeo = new THREE.SphereGeometry(size, 8, 8);
    const sphereMat = new THREE.MeshStandardMaterial({
      color: hintType.color,
      emissive: hintType.color,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.5 + 0.5 * (hint.confidence || 0.5),
      roughness: 0.3,
      metalness: 0.2,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(worldX, worldY, worldZ);
    sphere.userData = { hint };
    group.add(sphere);

    // 2) Dış halka (parlak kenar)
    const ringGeo = new THREE.RingGeometry(size * 1.2, size * 1.5, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: hintType.color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(sphere.position);
    ring.lookAt(0, worldY, 0); // Kameraya bakacak
    group.add(ring);

    // 3) Yüzeyden derinliğe çizgi (kılavuz)
    if (hint.depth > 1) {
      const lineGeo = new THREE.BufferGeometry();
      const lineVerts = new Float32Array([
        worldX, 0, worldZ,        // Yüzey
        worldX, worldY, worldZ,   // Derinlik
      ]);
      lineGeo.setAttribute('position', new THREE.BufferAttribute(lineVerts, 3));
      const lineMat = new THREE.LineDashedMaterial({
        color: hintType.color,
        transparent: true,
        opacity: 0.25,
        dashSize: 0.5,
        gapSize: 0.3,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.computeLineDistances();
      group.add(line);
    }
  }

  scene.add(group);
  invalidate();
  console.log(`[HybridHints] ${hints.length} ipucu 3D sahneye eklendi`);

  return group;
}

/**
 * Mevcut ipuçlarını sahneden temizle.
 */
export function removeHintsFromScene(scene) {
  if (!scene) return false;
  const existing = scene.getObjectByName('hybridHints');
  if (existing) {
    existing.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene.remove(existing);
    invalidate();
    console.log('[HybridHints] Eski ipuçları temizlendi');
    return true;
  }
  return false;
}

// ── İpucu Listesi (2D Panel) ──

/**
 * İpuçlarını HTML listesi olarak formatla.
 *
 * @param {Array} hints
 * @returns {string} HTML
 */
export function formatHintsList(hints) {
  if (!hints || hints.length === 0) {
    return '<div class="hints-empty">Henüz ipucu yok — çapraz doğrulama gerekli</div>';
  }

  const groups = {};
  for (const h of hints) {
    if (!groups[h.type]) groups[h.type] = [];
    groups[h.type].push(h);
  }

  const rows = [];
  for (const [type, items] of Object.entries(groups)) {
    const ht = HINT_TYPES[type] || HINT_TYPES.uncertain;
    const color = `#${ht.color.toString(16).padStart(6, '0')}`;

    rows.push(`<div class="hints-group">`);
    rows.push(`<div class="hints-group-title" style="color:${color}">${ht.label} (${items.length})</div>`);

    for (const h of items.slice(0, 10)) {
      rows.push(`
        <div class="hint-row" data-hint-x="${h.x}" data-hint-y="${h.y}" data-hint-depth="${h.depth}">
          <span class="hint-dot" style="background:${color}"></span>
          <span class="hint-label">${h.label}</span>
          <span class="hint-depth">${h.depth.toFixed(1)}m</span>
          <span class="hint-conf">${(h.confidence * 100).toFixed(0)}%</span>
        </div>
      `);
    }

    if (items.length > 10) {
      rows.push(`<div class="hints-more">+${items.length - 10} daha</div>`);
    }

    rows.push(`</div>`);
  }

  return `<div class="hints-list">${rows.join('')}</div>`;
}

// ── Rapor Entegrasyonu ──

/**
 * Çapraz doğrulama + ipucu durumunu tek raporda birleştir.
 *
 * @param {Object} crossValResult
 * @param {Array} hints
 * @returns {string} HTML
 */
export function generateCombinedReport(crossValResult, hints) {
  if (!crossValResult || !hints) return '';

  const consensusCount = hints.filter(h => h.type === 'consensus').length;
  const imageCount = hints.filter(h => h.type === 'imageStrong').length;
  const csvCount = hints.filter(h => h.type === 'csvStrong').length;
  const uncertainCount = hints.filter(h => h.type === 'uncertain').length;

  return `
    <div class="cv-combined-report">
      <div class="cvcr-header">
        <span class="cvcr-title">🔗 Hibrit Geri Besleme</span>
      </div>
      <div class="cvcr-stats">
        <div class="cvcr-stat">
          <span class="cvcr-dot" style="background:#9b5cf6"></span>
          <span class="cvcr-label">Konsensüs</span>
          <span class="cvcr-value">${consensusCount}</span>
        </div>
        <div class="cvcr-stat">
          <span class="cvcr-dot" style="background:#f59e0b"></span>
          <span class="cvcr-label">Image</span>
          <span class="cvcr-value">${imageCount}</span>
        </div>
        <div class="cvcr-stat">
          <span class="cvcr-dot" style="background:#3b82f6"></span>
          <span class="cvcr-label">CSV</span>
          <span class="cvcr-value">${csvCount}</span>
        </div>
        <div class="cvcr-stat">
          <span class="cvcr-dot" style="background:#6b7280"></span>
          <span class="cvcr-label">Belirsiz</span>
          <span class="cvcr-value">${uncertainCount}</span>
        </div>
      </div>
      <div class="cvcr-bar">
        <div class="cvcr-bar-fill consensus" style="width:${(consensusCount / Math.max(1, hints.length) * 100).toFixed(0)}%"></div>
        <div class="cvcr-bar-fill image" style="width:${(imageCount / Math.max(1, hints.length) * 100).toFixed(0)}%"></div>
        <div class="cvcr-bar-fill csv" style="width:${(csvCount / Math.max(1, hints.length) * 100).toFixed(0)}%"></div>
        <div class="cvcr-bar-fill uncertain" style="width:${(uncertainCount / Math.max(1, hints.length) * 100).toFixed(0)}%"></div>
      </div>
      <div class="cvcr-summary">
        ${consensusCount > 0 ? `✅ ${consensusCount} ipucu 3D haritaya eklendi` : ''}
        ${uncertainCount > 0 ? `⚠️ ${uncertainCount} belirsiz tespit — manuel kontrol gerekli` : ''}
      </div>
    </div>
  `;
}
