/**
 * CSV 3D Overlay — Magnetic anomaly visualization inside a pool cube.
 *
 * Coordinate system:
 *   X = left/right (Sol/Sağ) → 3D X
 *   Y = depth (Derinlik)     → 3D Y (negative = underground)
 *   Z = forward/back (İleri/Geri) → 3D Z
 *
 * Normalization: data coordinates are mapped to fit inside poolSizeM cube.
 * Magnetic values are shown as jet colormap on a heatmap plane (Y=0).
 * 3D points are plotted at their respective depths.
 */
import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { state } from "../app/state.js";
import { applyAlignment, transformPoint } from "./mapAlignment.js";
import { invalidate } from "./scene.js";
import { binCsvToGrid, renderHeatmapCanvas, computeGridStats, renderLegend, drawStructuresOnHeatmap } from "./csvHeatmap.js";
import { makeBadgeSprite } from "./labels.js";
import { computeBounds, filterUnderground, sliceDepths, sliceBandY } from "./csvFilter.js";

import { build2DGrid, detectStructuresFromTerrain } from "./csvAnalysis.js";

// ──────────────────────────────────────────────────────────
// Jet Colormap: cihaz ile birebir uyumlu
// ──────────────────────────────────────────────────────────

const JET_STOPS = [
  { t: 0.00, r: 0.0, g: 0.0, b: 0.5 },   // koyu mavi
  { t: 0.15, r: 0.0, g: 0.0, b: 1.0 },   // mavi
  { t: 0.30, r: 0.0, g: 1.0, b: 1.0 },   // cyan
  { t: 0.45, r: 0.0, g: 1.0, b: 0.0 },   // yeşil
  { t: 0.55, r: 1.0, g: 1.0, b: 0.0 },   // sarı
  { t: 0.75, r: 1.0, g: 0.5, b: 0.0 },   // turuncu
  { t: 1.00, r: 1.0, g: 0.0, b: 0.0 },   // kırmızı
];

/**
 * Manyetik anomali → jet colormap RGB (0-1).
 * @param {number} normalized -1..+1
 */
function jetColor(normalized) {
  const n = Math.max(0, Math.min(1, (normalized + 1) / 2));
  let lo = JET_STOPS[0], hi = JET_STOPS[JET_STOPS.length - 1];
  for (let i = 0; i < JET_STOPS.length - 1; i++) {
    if (n >= JET_STOPS[i].t && n <= JET_STOPS[i + 1].t) {
      lo = JET_STOPS[i]; hi = JET_STOPS[i + 1]; break;
    }
  }
  const f = (hi.t - lo.t) > 0 ? (n - lo.t) / (hi.t - lo.t) : 0;
  return [
    lo.r + (hi.r - lo.r) * f,
    lo.g + (hi.g - lo.g) * f,
    lo.b + (hi.b - lo.b) * f,
  ];
}

// ──────────────────────────────────────────────────────────
// İstatistikler
// ──────────────────────────────────────────────────────────

function computeStats(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, stddev: 1, min: 0, max: 0, median: 0 };
  let sum = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const mean = sum / n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (values[i] - mean) ** 2;
  const stddev = Math.sqrt(variance / n);
  // Median
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  return { mean, stddev, min, max, median };
}

// ──────────────────────────────────────────────────────────
// Koordinat normalizasyonu: ham veri → havuz içi dünya koordinatı
// ──────────────────────────────────────────────────────────

/**
 * Ham CSV verisini havuz içi koordinatlara dönüştür.
 * Verinin kendi aralığını kullanır, havuz boyutuna sığdırır.
 *
 * @param {Array} points - ham CSV noktaları
 * @param {Object} bounds - { xMin, xMax, yMin, yMax, zMin, zMax }
 * @param {number} poolSizeM - havuz boyutu (metre)
 * @returns {{ normalized: Array, bounds: Object, scale: number }}
 */
function normalizeData(points, bounds, dims, fitFactor = 1) {
  // ── Hizalama uygula (döndürme, ters çevirme, ölçek, kaydırma) ──
  const aligned = applyAlignment(points);

  // Hizalama sonrası sınırları yeniden hesapla
  let aXMin = Infinity, aXMax = -Infinity, aZMin = Infinity, aZMax = -Infinity;
  for (const p of aligned) {
    if (p.x < aXMin) aXMin = p.x;
    if (p.x > aXMax) aXMax = p.x;
    if (p.z < aZMin) aZMin = p.z;
    if (p.z > aZMax) aZMax = p.z;
  }

  const xRange = (aXMax - aXMin) || 1;
  const yRange = (bounds.yMax - bounds.yMin) || 1;
  const zRange = (aZMax - aZMin) || 1;

  // Veriyi havuz içine sığdırmak için ölçek — her eksen kendi boyutuna
  // fitFactor: 0..1 — havuzun kenarından uzak durma payı (anomali taşmasın)
  const xScale = (dims.w * fitFactor) / xRange;
  const yScale = (dims.h * fitFactor) / yRange;
  const zScale = (dims.d * fitFactor) / zRange;
  const xzScale = xScale; // geriye dönük uyumluluk (yapı yerleşimi)

  const xCenter = (aXMin + aXMax) / 2;
  const yCenter = (bounds.yMin + bounds.yMax) / 2;
  const zCenter = (aZMin + aZMax) / 2;

  const normalized = aligned.map(p => ({
    x: (p.x - xCenter) * xScale,
    y: (p.y - yCenter) * yScale,   // derinlik → dikey
    z: (p.z - zCenter) * zScale,  // ileri/geri → yatay Z
    magnetic: p.magnetic,
    // Ham değerleri koru (tooltip için)
    rawX: p.x, rawY: p.y, rawZ: p.z,
  }));

  return {
    normalized,
    scale: { xz: xScale, y: yScale, z: zScale },
    center: { x: xCenter, y: yCenter, z: zCenter },
  };
}

// ──────────────────────────────────────────────────────────
// 2D Manyetik Harita Yüzeyi (XZ düzleminde)
// ──────────────────────────────────────────────────────────

/**
 * Manyetik değerleri XZ yüzeyinde jet colormap ile çizer.
 * Bu cihazın ürettiği 2D haritanın3D karşılığıdır.
 *
 * @param {Array} points - normalize edilmiş noktalar
 * @param {Object} dims - { w, h, d } hacim boyutları
 * @param {Object} stats - magnetic istatistikleri
 * @param {number} resolution - grid çözünürlüğü
 * @returns {THREE.Mesh}
 */
function buildHeatmapSurface(points, dims, stats, resolution, boundsOpts) {
  const res = resolution || 128;
  const halfPool = dims.h / 2;
  // Sığdırma payı varsa grid bu sınırlara kurulur (kutu kenarından boşluk)
  const gBounds = boundsOpts || { xMin: -dims.w / 2, xMax: dims.w / 2, zMin: -dims.d / 2, zMax: dims.d / 2 };
  const gMinX = gBounds.xMin, gMaxX = gBounds.xMax, gMinZ = gBounds.zMin, gMaxZ = gBounds.zMax;

  const gd = build2DGrid(points, res, gBounds, true);
  const mGrid = gd.mGrid;
  const counts = gd.counts;

  // İstatistikler
  let mMin = Infinity, mMax = -Infinity;
  for (let i = 0; i < res * res; i++) {
    if (mGrid[i] < mMin) mMin = mGrid[i];
    if (mGrid[i] > mMax) mMax = mGrid[i];
  }
  const mMid = (mMax + mMin) / 2;
  const mSpread = Math.max(mMax - mMid, mMid - mMin, 1);
  const ANOMALY_THRESHOLD = 0.3; // ortalamadan %30 sapma = anomali

  console.log(`[CSV] Heatmap: ${res}x${res}, manyetik [${mMin.toFixed(0)}..${mMax.toFixed(0)}], eşik: ±${(ANOMALY_THRESHOLD*100).toFixed(0)}%`);

  const group = new THREE.Group();
  group.name = 'magneticHeatmap';

  const planeW = gMaxX - gMinX;
  const planeD = gMaxZ - gMinZ;
  const geo = new THREE.PlaneGeometry(planeW, planeD, res - 1, res - 1);
  geo.rotateX(-Math.PI / 2);
  // Fit sınırları merkezli yerleştir (küp merkezine göre kaydır)
  const planeCX = (gMinX + gMaxX) / 2;
  const planeCZ = (gMinZ + gMaxZ) / 2;
  geo.translate(planeCX, 0, planeCZ);
  const posAttr = geo.getAttribute('position');
  const colors = new Float32Array(posAttr.count * 3);

  const surfaceY = halfPool;
  const maxDrop = dims.h * 0.7;

  const planeSizeX = gMaxX - gMinX;
  const planeSizeZ = gMaxZ - gMinZ;
  for (let v = 0; v < posAttr.count; v++) {
    const wx = posAttr.getX(v) - gMinX;
    const wz = posAttr.getZ(v) - gMinZ;
    const gx = Math.min(res - 1, Math.max(0, Math.floor(wx / planeSizeX * res)));
    const gz = Math.min(res - 1, Math.max(0, Math.floor(wz / planeSizeZ * res)));
    const idx = gz * res + gx;

    const mNorm = (mGrid[idx] - mMid) / mSpread; // -1..+1

    // Sadece anomali olan yerde çökme — diğer yerler düz
    const isAnomaly = Math.abs(mNorm) > ANOMALY_THRESHOLD;
    if (isAnomaly) {
      // Anomali şiddetine göre derinlik
      const strength = (Math.abs(mNorm) - ANOMALY_THRESHOLD) / (1 - ANOMALY_THRESHOLD);
      const drop = strength * maxDrop;
      posAttr.setY(v, surfaceY - drop);
    } else {
      // Düz yüzey — hiçbir çökme yok
      posAttr.setY(v, surfaceY);
    }

    // Renk: anomali varsa jet colormap, yoksa koyu yeşil
    if (isAnomaly) {
      const [r, g, b] = jetColor(mNorm);
      colors[v * 3] = r; colors[v * 3 + 1] = g; colors[v * 3 + 2] = b;
    } else {
      colors[v * 3] = 0.1; colors[v * 3 + 1] = 0.15; colors[v * 3 + 2] = 0.1;
    }
  }

  posAttr.needsUpdate = true;
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    transparent: true, opacity: 0.92, roughness: 0.35, metalness: 0.08, depthWrite: false,
  });
  group.add(new THREE.Mesh(geo, mat));

  group.userData.gridData = { yGrid: gd.yGrid, mGrid, counts, gridRes: gd.gridRes, gBounds };
  return group;
}


// ──────────────────────────────────────────────────────────
// 3D Nokta Bulutu
// ──────────────────────────────────────────────────────────

/**
 * Tüm CSV noktalarını kendi3D pozisyonunda renklendirerek gösterir.
 * Noktalar derinliklerine (Y) göre yerleştirilir.
 */
function buildPointCloud(points, poolSizeM, stats, pointSize, useBinning, gridN) {
  const halfPool = poolSizeM / 2;
  const n = points.length;

  if (useBinning) {
    return buildBinnedCloud(points, poolSizeM, stats, gridN);
  }

  // Ham mod: her noktayı tek tek göster
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);

  for (let i = 0; i < n; i++) {
    const p = points[i];
    // X → X, Y → dikey (derinlik), Z → Z
    positions[i * 3]     = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    // Manyetik değer → jet colormap
    const anomNorm = (p.magnetic - stats.mean) / (stats.stddev || 1);
    const [r, g, b] = jetColor(Math.max(-3, Math.min(3, anomNorm)));
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const defaultSize = n > 10000 ? 0.12 : n > 1000 ? 0.2 : 0.4;
  const mat = new THREE.PointsMaterial({
    size: pointSize ?? defaultSize,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const mesh = new THREE.Points(geometry, mat);
  mesh.name = 'csvPoints';
  return mesh;
}

/**
 * 3D Voxel binning: düzensiz veriyi düzenli grid'e dönüştür + IDW interpolasyon.
 */
function buildBinnedCloud(points, poolSizeM, stats, gridN) {
  gridN = gridN || 32;
  const halfPool = poolSizeM / 2;
  const total = gridN * gridN * gridN;
  const cellSize = poolSizeM / gridN;

  const sums = new Float64Array(total);
  const counts = new Uint32Array(total);

  for (const p of points) {
    const gx = Math.min(gridN - 1, Math.max(0, Math.floor((p.x + halfPool) / cellSize)));
    const gy = Math.min(gridN - 1, Math.max(0, Math.floor((p.y + halfPool) / cellSize)));
    const gz = Math.min(gridN - 1, Math.max(0, Math.floor((p.z + halfPool) / cellSize)));
    const idx = gz * gridN * gridN + gy * gridN + gx;
    sums[idx] += p.magnetic;
    counts[idx]++;
  }

  // Ortalamalar
  const means = new Float32Array(total);
  const occCells = [];
  for (let i = 0; i < total; i++) {
    if (counts[i] > 0) {
      means[i] = sums[i] / counts[i];
      const gx = i % gridN;
      const gy = Math.floor(i / gridN) % gridN;
      const gz = Math.floor(i / (gridN * gridN));
      occCells.push({ gx, gy, gz, val: means[i] });
    }
  }

  // IDW: boş hücreleri doldur
  const values = new Float32Array(total);
  for (let gz = 0; gz < gridN; gz++) {
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const idx = gz * gridN * gridN + gy * gridN + gx;
        if (counts[idx] > 0) {
          values[idx] = means[idx];
          continue;
        }
        let wSum = 0, vSum = 0;
        for (const c of occCells) {
          const dx = gx - c.gx, dy = gy - c.gy, dz = gz - c.gz;
          const d2 = dx * dx + dy * dy + dz * dz;
          const w = 1 / (d2 + 0.25);
          wSum += w; vSum += w * c.val;
        }
        values[idx] = wSum > 0 ? vSum / wSum : stats.mean;
      }
    }
  }

  // Buffer attributes
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);

  for (let gz = 0; gz < gridN; gz++) {
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const idx = gz * gridN * gridN + gy * gridN + gx;
        positions[idx * 3]     = -halfPool + (gx + 0.5) * cellSize;
        positions[idx * 3 + 1] = -halfPool + (gy + 0.5) * cellSize;
        positions[idx * 3 + 2] = -halfPool + (gz + 0.5) * cellSize;

        const anomNorm = (values[idx] - stats.mean) / (stats.stddev || 1);
        const [r, g, b] = jetColor(Math.max(-3, Math.min(3, anomNorm)));
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const defaultSize = total > 10000 ? 0.15 : total > 1000 ? 0.25 : 0.4;
  const mat = new THREE.PointsMaterial({
    size: defaultSize,
    vertexColors: true,
    transparent: true,
    opacity: 0.8,
    sizeAttenuation: true,
    depthWrite: false,
  });

  const mesh = new THREE.Points(geometry, mat);
  mesh.name = 'csvPoints';
  mesh.userData.grid3d = values;
  mesh.userData.gridN = gridN;

  console.log(`[CSV] Voxel binning: ${points.length} → ${gridN}³ = ${total} hücre, ${occCells.length} dolu`);
  return mesh;
}

// ──────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────
// Yapıları küp içine yerleştir
// ──────────────────────────────────────────────────────────

function buildStructuresInCube(structures, poolSizeM, scales, filter) {
  if (!structures) return null;
  const group = new THREE.Group();
  group.name = 'csvStructures';
  const halfPool = poolSizeM / 2;
  const xzS = scales?.xz || 1;
  const yS = scales?.y || 1;

  const showChamber = !filter || filter.chamber !== false;
  const showTunnel  = !filter || filter.tunnel  !== false;
  const showMetal   = !filter || filter.metal   !== false;
  const chambers = showChamber ? (structures.chambers || []) : [];
  const tunnels  = showTunnel  ? (structures.tunnels  || []) : [];
  const metals   = showMetal   ? (structures.metals   || []) : [];
  let num = 1;

  // 3D'de tıklanınca bilgi paneli açılabilmesi için her parçayı (kutu/kenar/rozet)
  // focusId + tespit verisi ile etiketle — pick.js bu etiketleri kullanır.
  const tagStruct = (obj, kind, det) => {
    obj.userData.focusId = `csv-${kind}-${num}`;
    obj.userData.csvKind = kind;
    obj.userData.csvStructure = det;
    obj.userData.csvNum = num;
  };

  // ODA
  chambers.forEach(ch => {
    if (ch.kind === 'cavity') return;
    const cx = (Number(ch.cx) || 0);
    const cy = (Number(ch.cy) || 0);
    const topM = Number(ch.topFromSurfaceM ?? ch.top_from_surface_m ?? 0.4);
    const botM = Number(ch.bottomFromSurfaceM ?? ch.bottom_from_surface_m ?? topM + 2.5);
    const wM = Number(ch.widthM ?? ch.width_m ?? 2);
    const lM = Number(ch.lengthM ?? ch.length_m ?? wM);
    const hM = Math.max(botM - topM, 0.4);
    const isOpen = topM < 1.5 && ch.kind !== 'tomb';

    const sx = Math.max(wM, 0.5);
    const sz = Math.max(lM, 0.5);
    const sy = Math.max(hM, 0.5);
    const pos = new THREE.Vector3(cx, -((topM + botM) / 2), cy);

    if (isOpen) {
      // ── Üstü açık kazı alanı ──
      const wallH = Math.min(sy, 1.2);
      const wallThick = 0.08;
      // Taban
      const baseMesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, 0.05, sz),
        new THREE.MeshStandardMaterial({ color: 0x3a2810, transparent: true, opacity: 0.35, roughness: 1, side: THREE.DoubleSide, depthWrite: false })
      );
      baseMesh.position.copy(pos); baseMesh.position.y += 0.025;
      tagStruct(baseMesh, 'chamber', ch); group.add(baseMesh);
      // Duvarlar
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, transparent: true, opacity: 0.5, roughness: 0.7, side: THREE.DoubleSide, depthWrite: false });
      [[0, wallH/2, sz/2, sx, wallH, wallThick],
       [0, wallH/2, -sz/2, sx, wallH, wallThick],
       [sx/2, wallH/2, 0, wallThick, wallH, sz],
       [-sx/2, wallH/2, 0, wallThick, wallH, sz]].forEach(([wx, wy, wz, gw, gh, gd]) => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(gw, gh, gd), wallMat.clone());
        w.position.set(pos.x + wx, pos.y - wy, pos.z + wz);
        tagStruct(w, 'chamber', ch); group.add(w);
      });
      // Kontur çizgisi
      const edgeVerts = new Float32Array([
        pos.x-sx/2, pos.y, pos.z-sz/2, pos.x+sx/2, pos.y, pos.z-sz/2,
        pos.x+sx/2, pos.y, pos.z-sz/2, pos.x+sx/2, pos.y, pos.z+sz/2,
        pos.x+sx/2, pos.y, pos.z+sz/2, pos.x-sx/2, pos.y, pos.z+sz/2,
        pos.x-sx/2, pos.y, pos.z+sz/2, pos.x-sx/2, pos.y, pos.z-sz/2,
      ]);
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
      const edgeLine = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xc8a050, transparent: true, opacity: 0.85 }));
      tagStruct(edgeLine, 'chamber', ch); group.add(edgeLine);
    } else {
      // ── Kapalı oda ──
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const isTomb = ch.kind === 'tomb';
      const mat = new THREE.MeshStandardMaterial({
        color: isTomb ? 0x6a5acd : 0x4488cc,
        transparent: true, opacity: 0.82, roughness: 0.5,
        metalness: 0.12, side: THREE.DoubleSide, depthWrite: false,
        emissive: isTomb ? 0x2a1f5c : 0x16324f, emissiveIntensity: 0.25,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      tagStruct(mesh, 'chamber', ch);
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0xa8d4ff, transparent: true, opacity: 1.0 })
      );
      edges.position.copy(pos);
      tagStruct(edges, 'chamber', ch);
      group.add(edges);
    }

    const sprite = makeBadgeSprite(num, '#7eb6ff');
    sprite.position.set(pos.x, pos.y + sy * 0.55 + 0.6, pos.z);
    tagStruct(sprite, 'chamber', ch);
    group.add(sprite);
    num++;
  });

  // TÜNEL
  tunnels.forEach(t => {
    const x0 = Number(t.x0) || 0, y0 = Number(t.y0) || 0;
    const x1 = Number(t.x1) || 0, y1 = Number(t.y1) || 0;
    const depth = Number(t.floorFromSurfaceM ?? t.floor_from_surface_m ?? 2);
    const wM = Number(t.widthM ?? t.width_m ?? 1.2);

    const p0 = new THREE.Vector3(x0, -depth, y0);
    const p1 = new THREE.Vector3(x1, -depth, y1);
    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    if (len < 0.05) return;

    const radius = Math.max(wM * 0.5, 0.15);
    const geo = new THREE.CylinderGeometry(radius, radius, Math.max(len, 0.1), 12, 1, true);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4ec0d4, transparent: true, opacity: 0.78, roughness: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
      emissive: 0x1a4a55, emissiveIntensity: 0.3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(mid);
    const zAxis = dir.clone().normalize();
    let xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis);
    if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
    xAxis.normalize();
    const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    tagStruct(mesh, 'tunnel', t);
    group.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 1.0 })
    );
    edges.position.copy(mid);
    edges.quaternion.copy(mesh.quaternion);
    tagStruct(edges, 'tunnel', t);
    group.add(edges);

    const sprite = makeBadgeSprite(num, '#4ec0d4');
    sprite.position.set(mid.x, mid.y + 0.8, mid.z);
    tagStruct(sprite, 'tunnel', t);
    group.add(sprite);
    num++;
  });

  // METAL
  metals.forEach(m => {
    const cx = Number(m.cx) || 0, cy = Number(m.cy) || 0;
    const dM = Number(m.depthFromSurfaceM ?? m.depth_from_surface_m ?? 1);
    const wM = Math.max(Number(m.widthM ?? m.width_m ?? 1.2), 0.4);

    const pos = new THREE.Vector3(cx, -dM, cy);
    const s = Math.max(wM * 0.5, 0.2);

    const geo = new THREE.BoxGeometry(s, s * 0.5, s);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc04028, transparent: true, opacity: 0.85, roughness: 0.6,
      metalness: 0.2, emissive: 0x4a1208, emissiveIntensity: 0.45, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    tagStruct(mesh, 'metal', m);
    group.add(mesh);

    // Metal kenar çizgileri — yapı tek temsil olduğundan belirgin olsun
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xffb08a, transparent: true, opacity: 1.0 })
    );
    edges.position.copy(pos);
    tagStruct(edges, 'metal', m);
    group.add(edges);

    const haloGeo = new THREE.SphereGeometry(s * 1.5, 12, 8);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xc04028, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(pos);
    tagStruct(halo, 'metal', m);
    group.add(halo);

    const sprite = makeBadgeSprite(num, '#d4a060');
    sprite.position.set(pos.x, pos.y + 0.8, pos.z);
    tagStruct(sprite, 'metal', m);
    group.add(sprite);
    num++;
  });

  if (chambers.length + tunnels.length + metals.length > 0) {
    console.log(`[CSV] ${chambers.length} oda, ${tunnels.length} tünel, ${metals.length} metal eklendi`);
  }
  return group.children.length > 0 ? group : null;
}

// ──────────────────────────────────────────────────────────
// Eksen etiketi
// ──────────────────────────────────────────────────────────

function addAxisLabel(parent, text, x, y, z, size) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8fa898';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(text, 256, 44);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.6 })
  );
  sprite.position.set(x, y, z);
  sprite.scale.set(size * 3, size * 0.4, 1);
  parent.add(sprite);
}

// ──────────────────────────────────────────────────────────
// Isosurface — Marching Cubes ile 3D katı yüzeyler
// ──────────────────────────────────────────────────────────

function buildIsosurfaces(opts) {
  const { grid3d, gridN, poolSizeM, mean, stddev, sigma } = opts;
  if (!grid3d || !gridN) return null;

  const group = new THREE.Group();
  group.name = 'csvIsosurfaces';
  const halfPool = poolSizeM / 2;
  const cellScale = poolSizeM / gridN;
  const total = gridN * gridN * gridN;

  // Grid değerlerini 0..1 aralığına normalize et
  let gMin = Infinity, gMax = -Infinity;
  for (let i = 0; i < total; i++) {
    if (grid3d[i] < gMin) gMin = grid3d[i];
    if (grid3d[i] > gMax) gMax = grid3d[i];
  }
  const gRange = (gMax - gMin) || 1;
  const normGrid = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    normGrid[i] = (grid3d[i] - gMin) / gRange;
  }

  const normMean = (mean - gMin) / gRange;
  const normStd = stddev / gRange;

  console.log(`[CSV] Isosurface normalize: [${gMin.toFixed(0)}..${gMax.toFixed(0)}] → [0..1], mean=${normMean.toFixed(3)}, σ=${normStd.toFixed(3)}`);

  // Katmanlar: iç (kuvvetli anomali) → dış (zayıf)
  const levels = [];
  const nLevels = 5;
  for (let i = nLevels; i >= 1; i--) {
    const factor = (sigma || 2) * (i / nLevels);
    const thresh = normMean + factor * normStd;
    const opacity = 0.15 + (i / nLevels) * 0.4;
    levels.push({ threshold: thresh, opacity, factor });
  }
  for (let i = nLevels; i >= 1; i--) {
    const factor = (sigma || 2) * (i / nLevels);
    const thresh = normMean - factor * normStd;
    const opacity = 0.15 + (i / nLevels) * 0.4;
    levels.push({ threshold: thresh, opacity, factor, negative: true });
  }

  let totalTris = 0;
  const invCellScale = gridN / poolSizeM;

  for (const lvl of levels) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: lvl.opacity,
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mc = new MarchingCubes(gridN, mat, false, false);
    mc.enableColors = true;

    if (lvl.negative) {
      const negField = new Float32Array(total);
      for (let j = 0; j < total; j++) negField[j] = 1.0 - normGrid[j];
      mc.field.set(negField);
      mc.isolation = 1.0 - lvl.threshold;
    } else {
      mc.field.set(normGrid);
      mc.isolation = lvl.threshold;
    }

    mc.update();

    const geo = mc.geometry.clone();
    geo.scale(cellScale, cellScale, cellScale);
    geo.translate(-halfPool, -halfPool, -halfPool);
    geo.computeVertexNormals();

    if (!geo.getAttribute('position') || geo.getAttribute('position').count === 0) {
      geo.dispose(); mat.dispose();
      continue;
    }

    // Vertex renkleri: jet colormap
    const posAttr = geo.getAttribute('position');
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);

    for (let v = 0; v < count; v++) {
      const wx = posAttr.getX(v) + halfPool;
      const wy = posAttr.getY(v) + halfPool;
      const wz = posAttr.getZ(v) + halfPool;
      const gx = Math.min(gridN - 1, Math.max(0, Math.floor(wx * invCellScale)));
      const gy = Math.min(gridN - 1, Math.max(0, Math.floor(wy * invCellScale)));
      const gz = Math.min(gridN - 1, Math.max(0, Math.floor(wz * invCellScale)));
      const idx = gz * gridN * gridN + gy * gridN + gx;
      const normVal = normGrid[idx];
      const anomNorm = normVal * 2 - 1;
      const [r, g, b] = jetColor(anomNorm);
      colors[v * 3] = r;
      colors[v * 3 + 1] = g;
      colors[v * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `iso_${lvl.negative ? 'neg' : 'pos'}_${lvl.factor.toFixed(1)}`;
    group.add(mesh);
    totalTris += geo.getAttribute('position').count / 3;

    mc.geometry.dispose();
    mc.material.dispose();
  }

  console.log(`[CSV] Isosurface: ${levels.length} katman, ${totalTris} üçgen`);
  return group.children.length > 0 ? group : null;
}

// ──────────────────────────────────────────────────────────
// Ana overlay oluşturma
// ──────────────────────────────────────────────────────────

/**
 * CSV verisinden3D overlay oluştur.
 *
 * @param {Object} csvData - { points, xMin, xMax, yMin, yMax, zMin, zMax, magneticMin, magneticMax }
 * @param {Object} options - { sigma, poolSizeM, pointSize, gridN, structures, rawMode }
 * @returns {THREE.Group}
 */
export function buildCsvOverlay(csvData, options = {}) {
  if (!csvData?.points?.length) return null;

  let points = csvData.points;
  const totalRaw = points.length;
  const t0 = performance.now();
  console.log(`[CSV] Overlay: ${totalRaw} nokta işleniyor...`);

  // ── 1) Hacim boyutları (otomatik: veri dağılımına göre dikdörtgen kutu) ──
  // Güvenli varsayılan: geçersiz autoBox olsa bile kübik kutu korunur
  const _def = { w: options.poolSizeM || 30, h: options.poolSizeM || 30, d: options.poolSizeM || 30 };
  const _ab = options.autoBox;
  const dims = (_ab && isFinite(_ab.w) && isFinite(_ab.h) && isFinite(_ab.d)
    && _ab.w > 0 && _ab.h > 0 && _ab.d > 0)
    ? { w: _ab.w, h: _ab.h, d: _ab.d }
    : _def;

  // ── 1b) Yeraltı analiz motoru: anomali hariç, x<0 VE y<0 VE z<0 olmayan noktalar elenir.
  // Sensör yüzey üstünü de taradığı için (x≥0, y≥0 veya z≥0), yer altı
  // verisi yalnızca üç koordinatı da negatif olan noktalardır.
  const undergroundOnly = options.undergroundOnly !== false;
  // Sığdırma payı: 1 = kutuya tam yasla; otomatik modda kenar payı kutunun içinde zaten var
  const fitFactor = options.autoBox ? 1 : Math.max(0.3, Math.min(1, options.fitFactor ?? 0.85));
  // Derinlik dilimi: options.points verilmişse o dilimin noktaları gelir.
  if (options.points) {
    points = options.points;
  }
  let bounds = options.fixedBounds ?? computeBounds(points);
  let filteredCount = 0;
  if (undergroundOnly) {
    const res = filterUnderground(points);
    filteredCount = res.filteredCount;
    if (res.keptCount === 0) {
      console.warn('[CSV] Yeraltı filtresi: x<0 && y<0 && z<0 olan hiçbir nokta yok');
      return null;
    }
    if (filteredCount > 0) {
      console.log(`[CSV] Yeraltı filtresi: ${points.length} → ${res.keptCount} nokta (${filteredCount} elendi: x≥0, y≥0 veya z≥0)`);
    }
    points = res.points;
    if (!options.fixedBounds) bounds = computeBounds(points);
  }

  const n = points.length;

  // ── 2) Veriyi hacim içine normalize et (her eksen kendi boyutuna) ──
  const { normalized, scale, center } = normalizeData(points, bounds, dims, fitFactor);

  console.log(`[CSV] Normalize: X[${bounds.xMin.toFixed(0)}..${bounds.xMax.toFixed(0)}], Y[${bounds.yMin.toFixed(0)}..${bounds.yMax.toFixed(0)}], Z[${bounds.zMin.toFixed(0)}..${bounds.zMax.toFixed(0)}]`);
  console.log(`[CSV] Hacim: ${dims.w.toFixed(1)} × ${dims.h.toFixed(1)} × ${dims.d.toFixed(1)} m, fit=${(fitFactor * 100).toFixed(0)}%`);

  // Yüzeyin XZ sınırları da fit payına göre — kenar payı anomaliyi hacim çizgisinden ayırır
  const fitHalfW = (dims.w * fitFactor) / 2;
  const fitHalfD = (dims.d * fitFactor) / 2;
  const surfaceBounds = { xMin: -fitHalfW, xMax: fitHalfW, zMin: -fitHalfD, zMax: fitHalfD };

  // ── 3) Manyetik istatistikler ──
  const mags = normalized.map(p => p.magnetic);
  const stats = computeStats(mags);
  console.log(`[CSV] Manyetik: ort=${stats.mean.toFixed(0)}, σ=${stats.stddev.toFixed(0)}, min=${stats.min.toFixed(0)}, max=${stats.max.toFixed(0)}`);

  // ── 4) 3D Grubu oluştur ──
  const group = new THREE.Group();
  group.name = 'csvOverlay';

  // Isosurface/nokta bulutu için kübik referans (izometrik yaklaşım)
  const cubeRef = Math.max(dims.w, dims.h, dims.d);

  // ── 5) Manyetik harita yüzeyi (3D terrain) ──
  let heatmapMesh = null;
  try {
    heatmapMesh = buildHeatmapSurface(normalized, dims, stats, 128, surfaceBounds);
    if (heatmapMesh) group.add(heatmapMesh);
  } catch (e) {
    console.warn('[CSV] Heatmap yüzey hatası:', e);
  }

  // ── 6) 3D nokta bulutu ──
  const useBinning = !options.rawMode;
  const gridN = options.gridN || 32;
  const pointsMesh = buildPointCloud(normalized, cubeRef, stats, options.pointSize, useBinning, gridN);
  // Heatmap varsa noktaları gizle
  if (heatmapMesh && pointsMesh.material) {
    pointsMesh.visible = false;
  }
  group.add(pointsMesh);

  // ── 6b) Isosurface (Marching Cubes) ──
  if (useBinning && pointsMesh.userData?.grid3d) {
    try {
      const isoGroup = buildIsosurfaces({
        grid3d: pointsMesh.userData.grid3d,
        gridN: pointsMesh.userData.gridN || gridN,
        poolSizeM: cubeRef,
        mean: stats.mean,
        stddev: stats.stddev,
        sigma: options.sigma || 2,
      });
      if (isoGroup) group.add(isoGroup);
    } catch (isoErr) {
      console.warn('[CSV] Isosurface hatası:', isoErr);
    }
  }

  // ── 7) Hacim kutusu ──
  const boxGeo = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
  const boxEdges = new THREE.EdgesGeometry(boxGeo);
  const boxLine = new THREE.LineSegments(
    boxEdges,
    new THREE.LineBasicMaterial({ color: 0x3edc8c, transparent: true, opacity: 0.6 })
  );
  group.add(boxLine);

  // Üst yüzey şeffaf çizgi (yüzey seviyesi göstergesi)
  const surfGeo = new THREE.PlaneGeometry(dims.w, dims.d);
  const surfMat = new THREE.MeshBasicMaterial({
    color: 0x3edc8c, transparent: true, opacity: 0.04,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const surface = new THREE.Mesh(surfGeo, surfMat);
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = dims.h / 2; // Üst yüzey
  group.add(surface);

  // ── 7b) Seçili derinlik dilimi bandı — yarı saydam plaka ──
  // Plaka XZ yüzeyi fit payına göre daralır (band, veri alanını kaplar)
  const fitPlateW = dims.w * fitFactor;
  const fitPlateD = dims.d * fitFactor;
  const bandBox = sliceBandY(options.slice, options.sliceCount, dims.h, dims.h * fitFactor);
  if (bandBox) {
    const plateGeo = new THREE.BoxGeometry(fitPlateW, bandBox.thickness, fitPlateD);
    const plateMat = new THREE.MeshBasicMaterial({
      color: 0x3edc8c,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.y = bandBox.center;
    plate.name = 'sliceBandPlate';
    group.add(plate);

    // Band kenarları (izleme çizgileri)
    const bandEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(plateGeo),
      new THREE.LineBasicMaterial({ color: 0x3edc8c, transparent: true, opacity: 0.75 })
    );
    bandEdges.position.y = bandBox.center;
    bandEdges.name = 'sliceBandEdges';
    group.add(bandEdges);

    // Band etiketi — 8. bölüme gitmeden önce kendi sabitlerimizi kullan
    const bandHalf = dims.w / 2;
    addAxisLabel(
      group,
      `Dilim ${options.slice}/${options.sliceCount}`,
      bandHalf + 1.2,
      bandBox.center,
      0,
      dims.w * 0.108
    );
    console.log(`[CSV] Dilim bandı: dilim ${options.slice}/${options.sliceCount}, y=${bandBox.top.toFixed(2)}..${bandBox.bottom.toFixed(2)}m`);
  }

  // ── 8) Eksen etiketleri ──
  const labelSize = dims.w * 0.12;
  const halfW = dims.w / 2, halfH = dims.h / 2, halfD = dims.d / 2;
  addAxisLabel(group, `Sol/Sağ (X)`, halfW + 1, -halfH, 0, labelSize);
  addAxisLabel(group, `İleri/Geri (Z)`, 0, -halfH, halfD + 1, labelSize);
  addAxisLabel(group, `Derinlik (Y) ↓`, halfW + 1, 0, -halfD, labelSize);
  addAxisLabel(group, `Yüzey`, -halfW - 1, halfH, 0, labelSize * 0.7);

  // ── 9) Yapıları ekle (terrain'den tespit + opsiyonel dış yapılar) ──
  let structures = options.structures;
  if (!structures && heatmapMesh?.userData?.gridData) {
    const gd = heatmapMesh.userData.gridData;
    structures = detectStructuresFromTerrain(gd.yGrid, gd.mGrid, gd.counts, gd.gridRes, cubeRef, stats, {
      threshold: options.threshold,
      minStrength: options.minStrength,
      bounds: gd.gBounds, // grid ile aynı koordinat aralığını kullan
    });
  }
  if (structures) {
    // Yapıları harita sınırlarına kırp — heatmap dışına taşmasın
    const halfW = (dims.w * fitFactor) / 2;
    const halfD = (dims.d * fitFactor) / 2;
    const clampStruct = (s) => {
      const lo = -Math.max(halfW, halfD);
      const hi = Math.max(halfW, halfD);
      const clampXY = (v) => Math.max(lo, Math.min(hi, v));
      if (s.cx !== undefined) s.cx = clampXY(s.cx);
      if (s.cy !== undefined) s.cy = clampXY(s.cy);
      if (s.x0 !== undefined) s.x0 = clampXY(s.x0);
      if (s.x1 !== undefined) s.x1 = clampXY(s.x1);
      if (s.y0 !== undefined) s.y0 = clampXY(s.y0);
      if (s.y1 !== undefined) s.y1 = clampXY(s.y1);
    };
    (structures.chambers || []).forEach(clampStruct);
    (structures.tunnels  || []).forEach(clampStruct);
    (structures.metals   || []).forEach(clampStruct);

    const structGroup = buildStructuresInCube(structures, cubeRef, scale, options.structureFilter);
    if (structGroup) group.add(structGroup);
    group.userData.structures = structures; // İpuçları için sakla
  }

  // ── 10) userData kaydet ──
  const elapsed = (performance.now() - t0).toFixed(0);
  group.userData.anomalyStats = {
    total: n,
    totalRaw,
    filteredCount,
    undergroundOnly,
    positive: mags.filter(v => v > stats.mean).length,
    negative: mags.filter(v => v <= stats.mean).length,
    mean: stats.mean,
    stddev: stats.stddev,
    min: stats.min,
    max: stats.max,
    median: stats.median,
    xRange: { min: bounds.xMin, max: bounds.xMax },
    yRange: { min: bounds.yMin, max: bounds.yMax },
    zRange: { min: bounds.zMin, max: bounds.zMax },
    totalPoints: n,
    poolSizeM: cubeRef,
    dims,
    scale,
    elapsed,
  };

  group.userData.csvPoints = normalized;
  group.userData.csvBounds = bounds;
  group.userData.normCenter = center;
  group.userData.pointsMesh = pointsMesh;

  console.log(`[CSV] Overlay hazır: ${n} nokta, hacim=${dims.w.toFixed(1)}×${dims.h.toFixed(1)}×${dims.d.toFixed(1)}m (${elapsed}ms)`);
  return group;
}

// ──────────────────────────────────────────────────────────
// Karşılaştırma modu
// ──────────────────────────────────────────────────────────

/**
 * Karşılaştırma modunu overlay'a uygula.
 * @param {THREE.Group} overlay
 */
async function applyCompareMode(overlay) {
  if (!overlay) return;
  // compareMode'a dynamic import ile eriş (circular dependency önlemi)
  const { compareMode: cm } = await import("./mapAlignment.js");
  if (!cm || !cm.enabled) {
      // Mod kapalı — tüm noktaları görünür yap
      overlay.traverse(obj => {
        if (obj.material) {
          obj.material.clippingPlanes = [];
          if (obj.name === 'csvPoints') obj.material.opacity = 0.85;
        }
      });
      return;
    }

    overlay.traverse(obj => {
      if (!obj.material) return;

      if (cm.type === 'blend') {
        // Bindirme: CSV noktalarını yarı saydam yap
        if (obj.name === 'csvPoints') {
          obj.material.opacity = cm.blendOpacity * 0.9;
          obj.material.clippingPlanes = [];
        }
      } else if (cm.type === 'split') {
        // Split: X ekseninde split çizgisi
        if (obj.name === 'csvPoints' || obj.name === 'magneticHeatmap') {
          const splitX = (cm.splitPos - 0.5) * 40; // -20..+20 aralığında
          const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), splitX);
          obj.material.clippingPlanes = [plane];
          obj.material.clipShadows = true;
          obj.material.needsUpdate = true;
        }
      } else if (cm.type === 'grid') {
        // Grid: Izgara çizgileri ekle (overlay'a)
        if (obj.name === 'csvPoints') {
          obj.material.opacity = 0.6;
          obj.material.clippingPlanes = [];
        }
      }
    });

    // Grid modunda ızgara çizgileri ekle
    if (cm.type === 'grid' && !overlay.userData._gridLines) {
      const gridGroup = new THREE.Group();
      gridGroup.name = 'compareGrid';
      const gridMat = new THREE.LineBasicMaterial({ color: 0x3edc8c, transparent: true, opacity: 0.3 });
      const extent = 20;
      const step = 5;
      const verts = [];
      for (let i = -extent; i <= extent; i += step) {
        verts.push(-extent, 0.01, i, extent, 0.01, i);
        verts.push(i, 0.01, -extent, i, 0.01, extent);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      gridGroup.add(new THREE.LineSegments(geo, gridMat));
      overlay.add(gridGroup);
      overlay.userData._gridLines = gridGroup;
    } else if (cm.type !== 'grid' && overlay.userData._gridLines) {
      overlay.remove(overlay.userData._gridLines);
      overlay.userData._gridLines = null;
    }

    console.log(`[CSV] Karşılaştırma modu uygulandı: ${cm.type}`);
}

// ──────────────────────────────────────────────────────────
// Sahneye ekle / kaldır
// ──────────────────────────────────────────────────────────

export function addCsvOverlayToScene(csvData, options = {}) {
  removeCsvOverlay();
  // CSV ipuç topları çizilmez: yapılar zaten kutu/silindir + rozet olarak
  // buildStructuresInCube tarafından çizilir. Kürelerle üst üste binmesin.
  // (DTA ipuçları sahneye dokunmadan kalır — modül geçişinde korunur.)
  const overlay = buildCsvOverlay(csvData, options);
  if (!overlay) return null;

  state.csvOverlay = overlay;
  overlay.userData.votexLayer = "csv";
  state.scene.add(overlay);
  // Karşılaştırma modunu uygula
  applyCompareMode(overlay);
  invalidate();

  // Manyetik zemin overlay — CSV yüklendiğinde otomatik oluştur
  import("./groundMagneticOverlay.js").then(({ updateGroundMagneticOverlay }) => {
    updateGroundMagneticOverlay(overlay, options.surface || state.surface);
  }).catch(e => console.warn("[CSV] Manyetik zemin overlay hatası:", e));
  // Modül rayı görünürlüğüne uy (CSV overlay yalnız CSV/HİBRİT ekranında)
  const activeMod = document.querySelector("#votex-ray .vr-btn.active")?.dataset?.mod || "image";
  overlay.visible = activeMod === "csv" || activeMod === "hybrid";

  const s = overlay.userData.anomalyStats;
  if (s) {
    console.log(`[CSV] Havuz: ${s.poolSizeM}m, Nokta: ${s.totalPoints}`);
    console.log(`[CSV] Manyetik: ort=${s.mean?.toFixed(0)}, σ=${s.stddev?.toFixed(0)}`);
  }

  // 2D heatmap canvas
  renderCsvHeatmap(csvData, options);

  return overlay;
}

export function removeCsvOverlay() {
  if (state.csvOverlay) {
    state.csvOverlay.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    state.scene.remove(state.csvOverlay);
    state.csvOverlay = null;
  }
  // Manyetik zemin overlay'ı da temizle
  import("./groundMagneticOverlay.js").then(({ removeGroundMagneticOverlay }) => {
    removeGroundMagneticOverlay();
  }).catch(() => {});
  invalidate();
}

export function toggleCsvOverlay(visible) {
  if (state.csvOverlay) {
    state.csvOverlay.visible = visible;
    invalidate();
  }
}

// ──────────────────────────────────────────────────────────
// Anomali istatistikleri
// ──────────────────────────────────────────────────────────

export function anomalyStatsString(group) {
  const s = group?.userData?.anomalyStats;
  if (!s) return '';
  return [
    `Havuz: ${s.poolSizeM}m`,
    `Nokta: ${s.totalPoints} toplam`,
    `Manyetik: ort=${s.mean?.toFixed(0)}, σ=${s.stddev?.toFixed(0)}`,
    `Aralık: ${s.min?.toFixed(0)} — ${s.max?.toFixed(0)}`,
    `Pozitif: ${s.positive}, Negatif: ${s.negative}`,
  ].join('\n');
}

// ──────────────────────────────────────────────────────────
// 2D Heatmap Canvas (panel içinde)
// ──────────────────────────────────────────────────────────

/**
 * Heatmap canvas'ının sol ve alt kenarına metre eksen etiketleri çiz.
 * @param {number} xMin - X piksel minimum
 * @param {number} xMax - X piksel maksimum
 * @param {number} zMin - Z piksel minimum
 * @param {number} zMax - Z piksel maksimum
 */
function drawAxes(xMin, xMax, zMin, zMax) {
  // Y ekseni (sol kenar — Z değerleri)
  const yCanvas = document.getElementById('csv-heatmap-yaxis');
  if (yCanvas) {
    const ctx = yCanvas.getContext('2d');
    const w = yCanvas.width;
    const h = yCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#6a8a6a';
    const zRange = (zMax - zMin) || 1;
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const frac = i / nTicks;
      const y = h - frac * h; // üstten alta: büyük değerler üstte
      const rawVal = zMax - frac * zRange;
      const meterVal = (rawVal / 1e7).toFixed(1);
      ctx.fillText(`${meterVal}`, w - 2, y);
    }
  }

  // X ekseni (alt kenar — X değerleri)
  const xCanvas = document.getElementById('csv-heatmap-xaxis');
  if (xCanvas) {
    const parentW = xCanvas.parentElement?.offsetWidth || 300;
    xCanvas.width = parentW;
    xCanvas.height = 18;
    const ctx = xCanvas.getContext('2d');
    const w = xCanvas.width;
    const h = xCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#6a8a6a';
    const xRange = (xMax - xMin) || 1;
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const frac = i / nTicks;
      const x = frac * w;
      const rawVal = xMin + frac * xRange;
      const meterVal = (rawVal / 1e7).toFixed(1);
      ctx.fillText(`${meterVal}`, x, 2);
    }
  }
}

export function renderCsvHeatmap(csvData, options = {}) {
  // Split-view canvas'ı varsa onu kullan, yoksa panel canvas'ına fall back
  const canvas = document.getElementById('split-heatmap-canvas') || document.getElementById('csv-heatmap-canvas');
  if (!canvas || !csvData?.points?.length) return;

  const totalRaw = csvData.points.length;
  let points = options.points ?? csvData.points;
  if (options.undergroundOnly !== false) {
    const res = filterUnderground(points);
    if (res.keptCount > 0) points = res.points;
  }
  if (points.length === 0) {
    canvas.parentElement.style.display = 'none';
    return;
  }
  // Bounds: filtrelenmiş noktaların sınırlarını kullan — böylece heatmap veriyi tam kaplar
  const b = computeBounds(points);
  const xMin = b.xMin, xMax = b.xMax, yMin = b.yMin, yMax = b.yMax;
  const mMin = Math.min(...points.map(p => p.magnetic));
  const mMax = Math.max(...points.map(p => p.magnetic));

  const adaptiveGrid = Math.min(256, Math.max(64, Math.ceil(Math.sqrt(points.length) / 4)));
  const binnedGrid = binCsvToGrid(points, { xMin, xMax, yMin, yMax }, adaptiveGrid, adaptiveGrid);
  const gridStats = computeGridStats(binnedGrid.grid, binnedGrid.counts, binnedGrid.gridW, binnedGrid.gridH);

  const filledValues = [];
  for (let i = 0; i < binnedGrid.grid.length; i++) {
    if (binnedGrid.counts[i] > 0) filledValues.push(binnedGrid.grid[i]);
  }
  const stats = computeStats(new Float64Array(filledValues));
  const sigma = options.sigma ?? 2;
  const low = options.manualLow ?? (stats.mean - sigma * stats.stddev);
  const high = options.manualHigh ?? (stats.mean + sigma * stats.stddev);

  renderHeatmapCanvas(canvas, binnedGrid.grid, binnedGrid.counts, binnedGrid.gridW, binnedGrid.gridH, {
    magneticMin: mMin,
    magneticMax: mMax,
    low,
    high,
  });

  // Legend — split-view ve panel canvas'ını güncelle
  const legend = document.getElementById('split-heatmap-legend') || document.getElementById('csv-heatmap-legend');
  if (legend) renderLegend(legend, mMin, mMax, 16, 120);

  // Piksel→metre dönüşüm bilgisi (her iki blokta da kullanılır)
  const xRangeM = (xMax - xMin) / 1e7;
  const yRangeM = (yMax - yMin) / 1e7;

  const statsEl = document.getElementById('split-heatmap-stats') || document.getElementById('csv-heatmap-stats');
  if (statsEl) {
    const sliceNote = (options.slice && options.sliceCount > 1)
      ? `dilim ${options.slice}/${options.sliceCount} → `
      : '';
    const filterNote = (options.undergroundOnly !== false && points.length < totalRaw)
      ? `${totalRaw} ham → ${points.length} yeraltı → `
      : `${totalRaw} ham → `;
    statsEl.textContent = `${sliceNote}${filterNote}${binnedGrid.gridW}×${binnedGrid.gridH} grid (${gridStats.filledCells} hücre) | X: ${xRangeM}m  Z: ${yRangeM}m | μ=${stats.mean.toFixed(0)} σ=${stats.stddev.toFixed(0)} | Anomali: ${filledValues.filter(v => v < low || v > high).length}/${gridStats.filledCells}`;
  }

  // Split-view heatmap wrap'ı göster
  const splitWrap = document.getElementById('split-heatmap');
  if (splitWrap) splitWrap.style.display = '';

  // Y ekseni etiketleri
  const yaxisCanvas = document.getElementById('split-heatmap-yaxis');
  if (yaxisCanvas) {
    const yctx = yaxisCanvas.getContext('2d');
    yctx.clearRect(0, 0, yaxisCanvas.width, yaxisCanvas.height);
    yctx.fillStyle = '#0a1018';
    yctx.fillRect(0, 0, yaxisCanvas.width, yaxisCanvas.height);
    yctx.fillStyle = '#6a8a7a';
    yctx.font = '10px monospace';
    yctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = (i / 4) * yaxisCanvas.height;
      const val = mMax - (i / 4) * (mMax - mMin);
      yctx.fillText(val.toFixed(0), yaxisCanvas.width - 3, y + 4);
      yctx.strokeStyle = 'rgba(100,160,120,0.2)';
      yctx.beginPath();
      yctx.moveTo(yaxisCanvas.width - 2, y);
      yctx.lineTo(yaxisCanvas.width, y);
      yctx.stroke();
    }
  }

  // X ekseni etiketleri
  const xaxisCanvas = document.getElementById('split-heatmap-xaxis');
  if (xaxisCanvas) {
    xaxisCanvas.width = canvas.width;
    const xctx = xaxisCanvas.getContext('2d');
    xctx.clearRect(0, 0, xaxisCanvas.width, xaxisCanvas.height);
    xctx.fillStyle = '#0a1018';
    xctx.fillRect(0, 0, xaxisCanvas.width, xaxisCanvas.height);
    xctx.fillStyle = '#6a8a7a';
    xctx.font = '10px monospace';
    xctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * xaxisCanvas.width;
      const val = (xMin + (i / 4) * (xMax - xMin)) / 1e7;
      xctx.fillText(val.toFixed(1) + 'm', x, 12);
    }
  }

  // Split-view heatmap bilgisi
  const infoEl = document.getElementById('split-heatmap-info');
  if (infoEl) infoEl.textContent = `${binnedGrid.gridW}×${binnedGrid.gridH} | μ=${stats.mean.toFixed(0)} σ=${stats.stddev.toFixed(0)}`;

  // Yapı tespitlerini harita üzerine sembol + etiket olarak çiz
  const structures = options.structures;
  console.log(`[CSV Heatmap] renderCsvHeatmap structures:`, !!structures, structures ? `${(structures.chambers||[]).length}ch ${(structures.tunnels||[]).length}tu ${(structures.metals||[]).length}me` : 'yok');
  if (structures) {
    const ctx2d = canvas.getContext('2d');
    drawStructuresOnHeatmap(ctx2d, structures, {
      xMin, xMax,
      zMin: b.zMin ?? b.yMin, zMax: b.zMax ?? b.yMax,
    }, canvas.width, canvas.height, {
      filter: options.structureFilter,
      highlight: options.highlight || null,
      normParams: options.normParams || null,
    });
  }

  canvas.parentElement.style.display = '';
  // Heatmap wrap'ı da göster (display:none idi)
  const wrap = document.getElementById('csv-heatmap-wrap');
  if (wrap) wrap.style.display = '';

  // Birim gösterge çubuğunu güncelle
  const unitsEl = document.getElementById('csv-heatmap-units');
  if (unitsEl) {
    const scale = options.normParams?.scale?.xz || ((xMax - xMin) / 30);
    const pxPerM = (1 / scale) / 1e7;
    unitsEl.innerHTML = [
      `<span style="color:#5888e8;">Piksel</span>`,
      `<span style="color:#555;">(×10⁸)</span>`,
      `<span style="color:#3edc8c;font-weight:bold;">→</span>`,
      `<span style="color:#6aee88;">Metre</span>`,
      `<span style="color:#555;">|</span>`,
      `<span style="color:#e85858;">Manyetik</span>`,
      `<span style="color:#555;">nT</span>`,
      `<span style="color:#555;">|</span>`,
      `<span style="color:#888;font-size:0.58rem;">1m = 10⁷ piksel | X: ${xRangeM.toFixed(1)}m  Z: ${yRangeM.toFixed(1)}m</span>`,
    ].join(' ');
  }

  // Eksen etiketlerini çiz (metre)
  try {
    drawAxes(xMin, xMax, b.zMin ?? b.yMin, b.zMax ?? b.yMax);
  } catch (e) {
    console.warn('[CSV] Eksen çizimi hatası:', e);
  }
}
