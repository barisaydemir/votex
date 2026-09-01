/**
 * unifiedAnalysis.js — Tek Motorlu Birleşik Analiz
 *
 * Tek iş akışı:
 *   1. Image (birincil) → manyetik grid çıkar
 *   2. CSV (destek) → image grid'ini doğrula/düzelt
 *   3. Birleşik model → yapı tespiti
 *   4. Tek 3D sahne → her şeyi çiz
 *
 * Mantık:
 *   - Image birincil kaynaktır (görsel analiz)
 *   CSV destekleyici kaynaktır (sayısal doğrulama)
 *   - İkisi birleşince daha güvenilir sonuç elde edilir
 *   - Tek sahne, tek çizim, tek analiz
 */

import * as THREE from 'three';
import { extractMagneticGrid, renderGridToCanvas } from './imageProcessor.js';
import { CoordinateAligner } from './coordinateAlignment.js';
import { fuseDataSources } from './dataFusion.js';
import { analyzeDepth } from './depthAnalysis.js';
import { crossValidate, findConsensusDetections } from './crossValidation.js';
import { generateHints, addHintsToScene, removeHintsFromScene } from './hybridHints.js';
import { diagnoseImageDetections } from './imageDiagnostics.js';
import { state } from '../app/state.js';
import { invalidate } from '../viewer/scene.js';

// ── Sabitler ──

/** Havuz sınırları (metre) */
const POOL_DEFAULTS = { size: 30, half: 15 };

/** Yapı renkleri */
const STRUCTURE_COLORS = {
  chamber: 0x4a9eff,  // Mavi
  tunnel: 0x00d4aa,   // Camgöbeği
  metal: 0xff4444,    // Kırmızı
  hint_consensus: 0x9b5cf6, // Mor (konsensüs)
  hint_image: 0xf59e0b,     // Altın (sadece image)
  hint_csv: 0x3b82f6,       // Mavi (sadece CSV)
};

// ── Tek Fonksiyonlu Analiz ──

/**
 * Tek fonksiyonda tüm analizi çalıştır.
 *
 * @param {Object} params
 * @param {HTMLImageElement} params.image - Proton ELIC ekran görüntüsü
 * @param {Array} params.csvPoints - CSV noktaları [{x,y,magnetic}]
 * @param {Object} params.csvStructures - CSV yapı tespitleri
 * @param {Object} params.options - Analiz seçenekleri
 * @returns {Promise<Object>} Tüm sonuçlar
 */
export async function runUnifiedAnalysis(params) {
  const { image, csvPoints = [], csvStructures = null, options = {} } = params;

  const {
    csvWeight = 70,        // CSV ağırlığı (%)
    soilType = 'loam',     // Toprak profili
    poolSizeM = 30,        // Havuz boyutu (m)
    gridRes = 64,          // Grid çözünürlüğü
    ntRange = 500,         // nT aralığı
    scene = null,          // Three.js sahnesi
    showHints = true,      // İpuçlarını göster
    cvThresholds = {},     // Çapraz doğrulama eşikleri
    manualAligner = null,  // Manuel hizalama (varsa)
  } = options;

  const startTime = performance.now();
  console.log('[Unified] Başlıyor...');

  // ══════════════════════════════════════════════
  // ADIM 1: Image'dan manyetik grid çıkar (birincil)
  // ══════════════════════════════════════════════
  const { grid: imageGrid, lut, stats: imageStats } = extractMagneticGrid(image, {
    stripWidth: 20,
    gridRes,
    ntRange,
    matchThreshold: 0.35,
  });

  console.log(`[Unified] 1/4 Image grid: ${imageGrid.length} hücre, nT: ${imageStats.nTMin.toFixed(0)}..${imageStats.nTMax.toFixed(0)}`);

  // ══════════════════════════════════════════════
  // ADIM 2: CSV ile doğrula/düzelt (destek)
  // ══════════════════════════════════════════════
  let alignedCsv = csvPoints;
  let crossValResult = null;
  let hints = [];
  let aligner = null;

  if (csvPoints.length > 0) {
    // Image sınırlarını bul
    const imgBounds = {
      xMin: Math.min(...imageGrid.map(p => p.x)),
      xMax: Math.max(...imageGrid.map(p => p.x)),
      yMin: Math.min(...imageGrid.map(p => p.y)),
      yMax: Math.max(...imageGrid.map(p => p.y)),
    };

    // CSV sınırlarını bul
    const csvBounds = {
      xMin: Math.min(...csvPoints.map(p => p.x)),
      xMax: Math.max(...csvPoints.map(p => p.x)),
      yMin: Math.min(...csvPoints.map(p => p.y)),
      yMax: Math.max(...csvPoints.map(p => p.y)),
    };

    // Koordinat hizalama (manuel veya otomatik)
    if (manualAligner && manualAligner.transform) {
      aligner = manualAligner;
      console.log('[Unified] Manuel hizalama kullanılıyor:', aligner.transform);
    } else {
      aligner = new CoordinateAligner();
      aligner.autoAlign(imgBounds, csvBounds);
    }

    // CSV'yi image koordinatlarına çevir
    const csvInImageSpace = csvPoints.map(p => {
      const img = aligner.csvToImage(p.x, p.y);
      return { ...p, imageX: img.x, imageY: img.y };
    });

    // Image grid'ini CSV koordinatlarına çevir
    const imageInCsvSpace = aligner.transformImageGrid(imageGrid);

    // Fusion: ağırlıklı birleştirme
    const cw = csvWeight / 100;
    const fusionResult = fuseDataSources({
      imageGrid: imageInCsvSpace.map(p => ({ x: p.csvX, y: p.csvY, nT: p.nT, source: 'image' })),
      csvPoints: csvPoints.map(p => ({ x: p.x, y: p.y, magnetic: p.magnetic })),
      gridRes,
      csvWeight: cw,
      imageWeight: 1 - cw,
      searchRadius: 3,
      maxNeighbors: 8,
    });

    console.log(`[Unified] 2/4 Fusion: ${fusionResult.stats.filledCells} hücre, güven: ${(fusionResult.stats.avgConfidence * 100).toFixed(0)}%`);

    // Çapraz doğrulama — her iki taraf da metre koordinatlarında
    if (csvStructures) {
      // Image tespitlerini 0..1 normalize → metre koordinatına çevir
      // Gelişmiş: derinlik nT gradyanından, güven çok faktörlü
      const imgDiags = diagnoseImageDetections(imageGrid, gridRes, poolSizeM, imageStats, 150);
      const imgDets = imgDiags.map(d => {
        const csvCoord = aligner.imageToCsv(d.x, d.y);
        return {
          x: csvCoord.x, y: csvCoord.y,
          type: d.type,
          depth: d.depth,
          magnetic: d.nT,
          confidence: d.confidence,
          factors: d.factors,
        };
      });

      // CSV yapı tespitleri zaten metre koordinatlarında (detectStructuresFromTerrain)
      const csvDets = [
        ...(csvStructures.chambers || []).map(d => ({
          x: d.cx || 0, y: d.cy || 0,
          type: 'oda', depth: d.topFromSurfaceM || 5,
          magnetic: d.strength || 0, confidence: 0.8,
        })),
        ...(csvStructures.tunnels || []).map(d => ({
          x: ((d.x0 || 0) + (d.x1 || 0)) / 2,
          y: ((d.y0 || 0) + (d.y1 || 0)) / 2,
          type: 'tunnel', depth: d.floorFromSurfaceM || 5,
          magnetic: d.strength || 0, confidence: 0.75,
        })),
        ...(csvStructures.metals || []).map(d => ({
          x: d.cx || 0, y: d.cy || 0,
          type: 'metal', depth: d.depthFromSurfaceM || 3,
          magnetic: d.strength || 0, confidence: 0.85,
        })),
      ];

      if (imgDets.length > 0 && csvDets.length > 0) {
        crossValResult = crossValidate({
          imageDetections: imgDets,
          csvDetections: csvDets,
          thresholds: cvThresholds,
        });

        // İpuçları üret
        hints = generateHints(crossValResult, { minConfidence: 0.4, poolSizeM });

        console.log(`[Unified] 2b/4 Çapraz: ${crossValResult.matches.length} uyumlu, ${hints.length} ipucu`);
      }
    }

    alignedCsv = csvPoints;
  }

  // ══════════════════════════════════════════════
  // ADIM 3: Derinlik + Yapı Tespiti
  // ══════════════════════════════════════════════
  // Fusion: hem image hem CSV'yi metre koordinatında birleştir
  const alignedImageGrid = (csvPoints.length > 0 && aligner && aligner.transform)
    ? aligner.transformImageGrid(imageGrid)
    : null;

  const fusionGrid = csvPoints.length > 0 && alignedImageGrid
    ? (await fuseDataSources({
        imageGrid: alignedImageGrid.map(p => ({ x: p.csvX, y: p.csvY, nT: p.nT })),
        csvPoints: csvPoints.map(p => ({ x: p.x, y: p.y, magnetic: p.magnetic })),
        gridRes, csvWeight: csvWeight / 100, imageWeight: 1 - csvWeight / 100,
        searchRadius: 3, maxNeighbors: 8,
      })).grid
    : imageGrid.map(p => ({ x: p.x, y: p.y, magnetic: p.nT, confidence: 0.6, sources: ['image'] }));

  const depthResult = analyzeDepth({
    fusionGrid,
    gridRes, ntRange, soilType, maxDepth: 30,
  });

  console.log(`[Unified] 3/4 Derinlik: ${depthResult.stats.depthMin.toFixed(1)}..${depthResult.stats.depthMax.toFixed(1)}m`);

  // Yapıları tespit et (bileşik modelden)
  const structures = detectStructures(fusionGrid, depthResult, gridRes, poolSizeM);

  // ══════════════════════════════════════════════
  // ADIM 4: Tek 3D sahne oluştur
  // ══════════════════════════════════════════════
  if (scene) {
    // Eski temizle
    clearUnifiedScene(scene);

    // Yeni sahne oluştur
    const sceneGroup = new THREE.Group();
    sceneGroup.name = 'unifiedScene';
    sceneGroup.userData.votexLayer = 'hybrid'; // yalnız HİBRİT modülünde görünür

    // Yüzey (havuz tabanı)
    const surface = createSurface(poolSizeM);
    sceneGroup.add(surface);

    // Manyetik harita yüzeyi
    const magneticSurface = createMagneticSurface(imageGrid, poolSizeM, ntRange);
    sceneGroup.add(magneticSurface);

    // Yapıları çiz
    drawStructures(sceneGroup, structures, poolSizeM);

    // İpuçlarını çiz
    if (showHints && hints.length > 0) {
      addHintsToScene(scene, hints, { poolSizeM, yScale: 1 });
    }

    // Havuz kutusu
    const poolBox = createPoolBox(poolSizeM);
    sceneGroup.add(poolBox);

    scene.add(sceneGroup);

    // Kamerayı ayarla
    setupCamera(scene, poolSizeM);
    invalidate();

    console.log(`[Unified] 4/3D Sahne oluşturuldu: ${structures.length} yapı, ${hints.length} ipucu`);
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`[Unified] Tamamlandı (${elapsed}ms)`);

  return {
    imageGrid,
    imageStats,
    fusionGrid,
    depthResult,
    structures,
    hints,
    crossValResult,
    elapsed: Number(elapsed),
  };
}

// ── Yapı Tespiti ──

/**
 * Fusion grid + derinlik verisinden yapıları tespit et.
 */
function detectStructures(fusionGrid, depthResult, gridRes, poolSizeM) {
  const structures = [];
  const halfPool = poolSizeM / 2;

  // Güçlü manyetik sinyaller → metal
  for (const cell of fusionGrid) {
    if (Math.abs(cell.magnetic || 0) > 300 && (cell.confidence || 0) > 0.5) {
      const worldX = (cell.x - 0.5) * poolSizeM;
      const worldZ = (cell.y - 0.5) * poolSizeM;
      const depthCell = depthResult.depthGrid.find(d => d.gx === cell.gx && d.gy === cell.gy);
      const depth = depthCell?.depth || 5;

      structures.push({
        type: cell.magnetic > 0 ? 'metal' : 'void',
        x: worldX,
        y: -depth,
        z: worldZ,
        depth,
        magnetic: cell.magnetic,
        confidence: cell.confidence || 0.5,
        size: 1.5,
      });
    }
  }

  // Geniş düşük sinyal bölgeleri → boşluk/oda
  for (const cell of fusionGrid) {
    if ((cell.magnetic || 0) < -200 && (cell.confidence || 0) > 0.4) {
      // Komşu hücreleri kontrol et — geniş bir boşluk mu?
      const neighbors = fusionGrid.filter(c =>
        Math.abs(c.x - cell.x) < 0.1 &&
        Math.abs(c.y - cell.y) < 0.1 &&
        (c.magnetic || 0) < -150
      );

      if (neighbors.length >= 4) {
        const worldX = (cell.x - 0.5) * poolSizeM;
        const worldZ = (cell.y - 0.5) * poolSizeM;
        const depthCell = depthResult.depthGrid.find(d => d.gx === cell.gx && d.gy === cell.gy);
        const depth = depthCell?.depth || 5;

        // Zaten yakınlarda bir oda var mı?
        const nearby = structures.find(s =>
          s.type === 'chamber' &&
          Math.abs(s.x - worldX) < 3 &&
          Math.abs(s.z - worldZ) < 3
        );

        if (!nearby) {
          structures.push({
            type: 'chamber',
            x: worldX,
            y: -depth,
            z: worldZ,
            depth,
            magnetic: cell.magnetic,
            confidence: cell.confidence || 0.4,
            size: Math.max(2, neighbors.length * 0.5),
          });
        }
      }
    }
  }

  return structures;
}

// ── 3D Yardımcılar ──

function createSurface(poolSizeM) {
  const geo = new THREE.PlaneGeometry(poolSizeM, poolSizeM);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a2a3a,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return mesh;
}

function createMagneticSurface(imageGrid, poolSizeM, ntRange) {
  const res = Math.ceil(Math.sqrt(imageGrid.length));
  const geo = new THREE.PlaneGeometry(poolSizeM, poolSizeM, res - 1, res - 1);
  const positions = geo.attributes.position.array;
  const colors = new Float32Array(positions.length);

  for (let i = 0; i < imageGrid.length && i < res * res; i++) {
    const cell = imageGrid[i];
    const idx = i * 3;
    if (idx + 2 < positions.length) {
      // Z pozisyonunu manyetik değere göre ayarla
      const height = ((cell.nT || 0) / ntRange) * 2;
      positions[idx + 2] = -height;
    }

    // Renk: kırmızı (pozitif) / mavi (negatif)
    const normalized = (cell.nT || 0) / ntRange;
    if (normalized > 0) {
      colors[idx] = 0.8 + 0.2 * normalized;     // R
      colors[idx + 1] = 0.2 * normalized;        // G
      colors[idx + 2] = 0.2;                     // B
    } else {
      const abs = Math.abs(normalized);
      colors[idx] = 0.2;                         // R
      colors[idx + 1] = 0.2 * abs;               // G
      colors[idx + 2] = 0.8 + 0.2 * abs;        // B
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.1;
  return mesh;
}

function drawStructures(group, structures, poolSizeM) {
  for (const s of structures) {
    const color = STRUCTURE_COLORS[s.type] || 0xffffff;
    const size = s.size || 1.5;

    // Küre
    const geo = new THREE.SphereGeometry(size * 0.5, 8, 8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      transparent: true,
      opacity: 0.6 + 0.4 * (s.confidence || 0.5),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(s.x, s.y, s.z);
    mesh.userData = { structure: s };
    group.add(mesh);

    // Halka
    const ringGeo = new THREE.RingGeometry(size * 0.6, size * 0.8, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(s.x, s.y, s.z);
    ring.lookAt(0, s.y, 0);
    group.add(ring);
  }
}

function createPoolBox(poolSizeM) {
  const geo = new THREE.BoxGeometry(poolSizeM, poolSizeM, poolSizeM);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color: 0x3edc8c, transparent: true, opacity: 0.5 });
  const box = new THREE.LineSegments(edges, mat);
  box.position.y = -poolSizeM / 2;
  return box;
}

function setupCamera(scene, poolSizeM) {
  // Camera ve controls state'te olmalı
  if (state.camera && state.controls) {
    const dist = poolSizeM * 2;
    state.camera.position.set(dist * 0.6, dist * 0.4, dist * 0.5);
    state.controls.target.set(0, -poolSizeM / 4, 0);
    state.controls.update();
  }
}

/**
 * Birleşik analiz sahnesini sahneden tamamen kaldır (geometri/materyal dispose edilir).
 * HİBRİT modülünden çıkınca rail.js bu fonksiyonu çağırır — gizlemek yerine temizler.
 * @param {THREE.Scene} scene
 * @returns {boolean} bir şey kaldırıldı mı
 */
export function clearUnifiedScene(scene) {
  if (!scene) return false;
  let removed = false;
  // Eski unified sahneyi temizle
  const existing = scene.getObjectByName('unifiedScene');
  if (existing) {
    existing.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    scene.remove(existing);
    removed = true;
  }

  // Eski ipuçlarını temizle
  removed = removeHintsFromScene(scene) || removed;
  return removed;
}

// ── 2D Harita ──

/**
 * Image + CSV birleşik 2D harita oluştur.
 *
 * @param {Array} imageGrid
 * @param {Array} csvPoints
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} ntRange
 * @returns {HTMLCanvasElement}
 */
export function createUnified2DMap(imageGrid, csvPoints, canvasW, canvasH, ntRange = 500) {
  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Siyah zemin
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Image grid'i çiz
  if (imageGrid.length > 0) {
    const gridRes = Math.ceil(Math.sqrt(imageGrid.length));
    const cellW = canvasW / gridRes;
    const cellH = canvasH / gridRes;

    for (const cell of imageGrid) {
      const normalized = (cell.nT || 0) / ntRange;
      let r, g, b;

      if (normalized > 0) {
        r = Math.round(128 + 127 * normalized);
        g = Math.round(50 * normalized);
        b = Math.round(50);
      } else {
        const abs = Math.abs(normalized);
        r = Math.round(50);
        g = Math.round(50 * abs);
        b = Math.round(128 + 127 * abs);
      }

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(cell.gx * cellW, cell.gy * cellH, cellW + 1, cellH + 1);
    }
  }

  // CSV noktalarını çiz ( beyaz noktalar )
  if (csvPoints.length > 0) {
    const xMin = Math.min(...csvPoints.map(p => p.x));
    const xMax = Math.max(...csvPoints.map(p => p.x));
    const yMin = Math.min(...csvPoints.map(p => p.y));
    const yMax = Math.max(...csvPoints.map(p => p.y));

    ctx.fillStyle = '#ffffff';
    for (const p of csvPoints) {
      const px = ((p.x - xMin) / (xMax - xMin || 1)) * canvasW;
      const py = ((p.y - yMin) / (yMax - yMin || 1)) * canvasH;
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Legend
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(8, canvasH - 40, 120, 35);
  ctx.font = '10px monospace';
  ctx.fillStyle = '#ff6a4a'; ctx.fillText('● Image', 14, canvasH - 26);
  ctx.fillStyle = '#ffffff'; ctx.fillText('● CSV', 14, canvasH - 14);

  return canvas;
}
