/**
 * consensusVisuals.js — Konsensüs Görselleştirme
 *
 * Cross-validation tarafından doğrulanmış tespitleri 3D sahneye yansıtır:
 *   - Mor renkli konsensüs marker'ları (sphere + etiket)
 *   - Image↔CSV eşleşme çizgileri (gradient renk)
 *   - Uyumsuzluk uyarı işaretleri (sarı daire)
 *
 * Geri dönüşümlü: clearConsensus() ile tamamen temizlenir.
 */

import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "../viewer/scene.js";

// ── Sabitler ──

const CONSENSUS_COLOR = 0x9b5cf6;    // Mor — onaylı tespit
const MISMATCH_COLOR = 0xf59e0b;      // Sarı — uyumsuz
const UNMATCHED_COLOR = 0x6b7280;     // Gri — eşleşmemiş
const MATCH_LINE_COLOR = 0x9b5cf6;    // Mor — eşleşme çizgisi
const MARKER_RADIUS = 0.25;
const MARKER_SEGMENTS = 16;

// ── Grup ──

let consensusGroup = null;

/**
 * Konsensüs görselleştirme grubunu oluştur.
 */
function ensureGroup() {
  if (consensusGroup) return consensusGroup;
  consensusGroup = new THREE.Group();
  consensusGroup.name = "consensusVisuals";
  return consensusGroup;
}

/**
 * Cross-validation sonucunu 3D sahneye yansıt.
 *
 * @param {Object} crossValResult - crossValidate() çıktısı
 *   { matches, mismatches, unmatchedImage, unmatchedCsv, stats }
 */
export function showConsensus(crossValResult) {
  clearConsensus();
  if (!crossValResult) return;

  const group = ensureGroup();
  if (state.scene && !state.scene.children.includes(group)) {
    state.scene.add(group);
  }

  const { matches = [], mismatches = [], unmatchedImage = [], unmatchedCsv = [] } = crossValResult;

  // 1) Onaylı eşleşmeler — mor sphere + etiket
  for (const m of matches) {
    if (!m.isConsistent) continue;
    const det = m.csv || m.image;
    if (!det) continue;

    // Marker
    const geo = new THREE.SphereGeometry(MARKER_RADIUS, MARKER_SEGMENTS, MARKER_SEGMENTS);
    const mat = new THREE.MeshStandardMaterial({
      color: CONSENSUS_COLOR,
      emissive: CONSENSUS_COLOR,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(det.x || 0, -(det.depth || 1), det.y || 0);
    mesh.name = `consensus-${det.type || 'unknown'}`;
    mesh.userData = {
      kind: "consensus",
      type: det.type,
      confidence: m.confidence,
      image: m.image,
      csv: m.csv,
    };
    group.add(mesh);

    // Image→CSV çizgisi (eşleşme doğrultusu)
    if (m.image && m.csv) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(m.image.x || 0, -(m.image.depth || 1), m.image.y || 0),
        new THREE.Vector3(m.csv.x || 0, -(m.csv.depth || 1), m.csv.y || 0),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: MATCH_LINE_COLOR,
        transparent: true,
        opacity: 0.4,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      line.name = "consensusLine";
      group.add(line);
    }

    // Halka (yüzeyde)
    const ringGeo = new THREE.RingGeometry(MARKER_RADIUS * 1.5, MARKER_RADIUS * 2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: CONSENSUS_COLOR,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(det.x || 0, 0.03, det.y || 0);
    group.add(ring);
  }

  // 2) Uyumsuz eşleşmeler — sarı halka
  for (const m of mismatches) {
    const det = m.csv || m.image;
    if (!det) continue;

    const ringGeo = new THREE.RingGeometry(MARKER_RADIUS * 2, MARKER_RADIUS * 2.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: MISMATCH_COLOR,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(det.x || 0, 0.04, det.y || 0);
    ring.userData = {
      kind: "mismatch",
      depthDiff: m.depthDiff,
      magneticDiff: m.magneticDiff,
      typeMatch: m.typeMatch,
    };
    group.add(ring);
  }

  console.log(`[ConsensusVisuals] ${matches.filter(m => m.isConsistent).length} onaylı, ${mismatches.length} uyumsuz`);
  invalidate();
}

/**
 * Tüm konsensüs görsellerini temizle.
 */
export function clearConsensus() {
  if (!consensusGroup) return;
  consensusGroup.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
  if (consensusGroup.parent) {
    consensusGroup.parent.remove(consensusGroup);
  }
  consensusGroup = null;
  invalidate();
}

/**
 * Konsensüs görselleştirme durumunu döndür (raporlama için).
 */
export function getConsensusStats() {
  if (!consensusGroup) return { visible: false, count: 0 };

  let consensusCount = 0;
  let mismatchCount = 0;

  consensusGroup.traverse(child => {
    if (child.userData?.kind === "consensus") consensusCount++;
    if (child.userData?.kind === "mismatch") mismatchCount++;
  });

  return {
    visible: true,
    consensusCount,
    mismatchCount,
    totalCount: consensusCount + mismatchCount,
  };
}
