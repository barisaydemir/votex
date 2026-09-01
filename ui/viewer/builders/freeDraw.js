import * as THREE from "three";
import { state } from "../../app/state.js";
import { invalidate } from "../scene.js";
import { mapToWorld, depthRangeOf } from "../coords.js";
import { makeFootprintVolume, planOutline } from "./footprint.js";
import { t } from "../../i18n/index.js";

function resolveColors(surface) {
  const c = surface?.colors;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  if (c instanceof Uint8Array) return Array.from(c);
  if (typeof c === "object" && c.length != null) return Array.from(c);
  return [];
}

function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max < 1e-6 ? 0 : d / max, v: max };
}

function isWhite(r, g, b) {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  return mn > 175 && mx - mn < 42;
}

/** ELIC ara bant — yeşil zemin çizilmez. */
export function bandOf(r, g, b) {
  if (isWhite(r, g, b)) return "white";
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.12 || s < 0.12) return "skip";
  if (h >= 75 && h <= 155 && g >= r - 8 && g >= b - 12) return "skip";
  if (h >= 250 && h <= 320) return "purple";
  if (h >= 195 && h < 250) return "blue";
  if (h >= 155 && h < 195) return "cyan";
  if (h >= 42 && h < 75) return "yellow";
  if (h >= 18 && h < 42) return "orange";
  if (h < 18 || h > 320) return "red";
  return "skip";
}

export const BANDS = {
  cyan: { id: "cyan", pool: true, depthFrac: 0.55, opacity: 0.42, rim: 0xd8f4f0, maxN: 12, key: "sc.toneCyan", hex: "#4ec4d4" },
  blue: { id: "blue", pool: true, depthFrac: 0.88, opacity: 0.5, rim: 0xf4f1e8, maxN: 16, key: "sc.toneBlue", hex: "#2a7ec8" },
  purple: { id: "purple", pool: true, depthFrac: 1, opacity: 0.48, rim: 0xe8d8f0, maxN: 10, key: "sc.tonePurple", hex: "#7a4ab8" },
  yellow: { id: "yellow", pool: false, depthFrac: 0.22, opacity: 0.52, rim: 0x8a7a20, maxN: 12, key: "sc.toneYellow", hex: "#d4b42a" },
  orange: { id: "orange", pool: false, depthFrac: 0.32, opacity: 0.6, rim: 0x8a4814, maxN: 12, key: "sc.toneOrange", hex: "#d87820" },
  red: { id: "red", pool: false, depthFrac: 0.42, opacity: 0.76, rim: 0x8a2814, maxN: 14, key: "sc.toneRed", hex: "#c4452a" },
  white: { id: "white", pool: false, depthFrac: 0.18, opacity: 0.48, rim: 0x8a8880, maxN: 14, key: "sc.toneWhite", hex: "#f4f1e8" },
  hot: { id: "hot", pool: false, depthFrac: 0.28, opacity: 0.7, rim: 0xf0ece0, maxN: 8, key: "sc.toneHot", hex: "#f2efe6" },
  wall: { id: "wall", pool: false, key: "sc.toneWall", hex: "#f4f1e8" },
  contact: { id: "contact", pool: false, key: "fd.contacts", hex: "#c9b46a" },
};

export const FREE_DRAW_BAND_ORDER = ["purple", "blue", "cyan", "yellow", "orange", "red", "white", "hot", "wall"];

function rgbInt(r, g, b) {
  return ((Math.round(r) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(b) & 255);
}

function meanRgb(cells, colors) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const k of cells) {
    const o = k * 3;
    if (o + 2 >= colors.length) continue;
    r += colors[o];
    g += colors[o + 1];
    b += colors[o + 2];
    n += 1;
  }
  if (!n) return [42, 158, 208];
  return [r / n, g / n, b / n];
}

/**
 * Adaptif minPx: grid boyutuna göre minimum piksel eşiği.
 * Büyük haritalarda daha yüksek eşik → daha az küçük blob → daha hızlı.
 */
export function adaptiveMinPx(gw, gh) {
  const total = gw * gh;
  if (total > 40000) return Math.max(8, Math.round(total / 3500));  // 200×200+
  if (total > 10000) return Math.max(6, Math.round(total / 2800));  // 100×100+
  return Math.max(4, Math.round(total / 2200));                      // küçük
}

export function blobsFromMask(mask, gw, gh, minPx) {
  const seen = new Uint8Array(mask.length);
  const blobs = [];
  const n4 = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const cells = [];
    while (stack.length) {
      const k = stack.pop();
      cells.push(k);
      const x = k % gw;
      const y = (k / gw) | 0;
      for (const [dx, dy] of n4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (!mask[j] || seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (cells.length >= minPx) blobs.push(cells);
  }
  blobs.sort((a, b) => b.length - a.length);
  return blobs;
}

/**
 * Douglas-Peucker simplification — outline point sayısını azaltır.
 * points: [{x, y}] ring formatında (normalized 0-1).
 * tolerance: max izin verilen sapma (harita koordinatında).
 */
export function douglasPeucker(points, tolerance) {
  if (points.length <= 3) return points;
  const tol2 = tolerance * tolerance;

  function rdp(pts, first, last, keep) {
    if (last - first < 2) return;
    let maxDist = 0;
    let maxIdx = first;
    const fx = pts[first].x;
    const fy = pts[first].y;
    const lx = pts[last].x;
    const ly = pts[last].y;
    const dx = lx - fx;
    const dy = ly - fy;
    const len2 = dx * dx + dy * dy;
    for (let i = first + 1; i < last; i++) {
      const px = pts[i].x - fx;
      const py = pts[i].y - fy;
      const cross = Math.abs(dx * py - dy * px);
      const dist2 = len2 > 1e-10 ? (cross * cross) / len2 : px * px + py * py;
      if (dist2 > maxDist) {
        maxDist = dist2;
        maxIdx = i;
      }
    }
    if (maxDist > tol2) {
      keep[maxIdx] = true;
      rdp(pts, first, maxIdx, keep);
      rdp(pts, maxIdx, last, keep);
    }
  }

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  rdp(points, 0, points.length - 1, keep);

  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out.length >= 4 ? out : points.slice(0, 8);
}

/**
 * Adaptif LOD: blob boyutuna göre outline point limitini belirle.
 * Büyük blob'lar daha az point (hız), küçük blob'lar daha fazla (detay).
 */
export function adaptiveOutlineLimit(cellCount, gw, gh) {
  const totalCells = gw * gh;
  if (cellCount > totalCells * 0.05) return 16;  // çok büyük: sadece 16 nokta
  if (cellCount > totalCells * 0.01) return 20;  // büyük: 20 nokta
  if (cellCount > 500) return 24;                 // orta: 24 nokta
  return 28;                                      // küçük: tam detay (mevcut)
}

export function outlineFromCells(cells, gw, gh) {
  const set = new Set(cells);
  const ring = [];
  for (const k of cells) {
    const x = k % gw;
    const y = (k / gw) | 0;
    const border =
      !set.has(y * gw + (x + 1)) || !set.has(y * gw + (x - 1)) || !set.has((y + 1) * gw + x) || !set.has((y - 1) * gw + x);
    if (border) ring.push({ x: (x + 0.5) / gw, y: (y + 0.5) / gh });
  }
  if (ring.length < 4) return null;

  // Centroid hesapla
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;

  // Açıya göre sırala
  ring.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  // Adaptif LOD limiti belirle
  const targetPts = adaptiveOutlineLimit(cells.length, gw, gh);

  // Douglas-Peucker ile basitleştir
  // Tolerans: blob'un ortalama yarıçapının %15'i (büyük blob = daha geniş tolerans)
  let r = 0;
  for (const p of ring) {
    r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  }
  const tolerance = r * 0.15;

  let simplified = douglasPeucker(ring, tolerance);

  // Eğer hala limitin üstündeyse, step ile dezentegre et
  if (simplified.length > targetPts) {
    const step = Math.max(1, Math.floor(simplified.length / targetPts));
    const dec = [];
    for (let i = 0; i < simplified.length; i += step) dec.push(simplified[i]);
    if (dec[dec.length - 1] !== simplified[simplified.length - 1]) dec.push(simplified[simplified.length - 1]);
    simplified = dec.length >= 4 ? dec : simplified.slice(0, 8);
  }

  return simplified;
}

function fieldSpan(cells, heights) {
  let minH = 0;
  let maxAbs = 0;
  let n = 0;
  for (const k of cells) {
    const h = Number(heights[k]);
    if (!Number.isFinite(h)) continue;
    n += 1;
    if (h < minH) minH = h;
    maxAbs = Math.max(maxAbs, Math.abs(h));
  }
  return { minH, maxAbs, n };
}

function centroidOfCells(cells, gw, gh) {
  let sx = 0;
  let sy = 0;
  for (const k of cells) {
    sx += (k % gw) + 0.5;
    sy += ((k / gw) | 0) + 0.5;
  }
  const n = Math.max(cells.length, 1);
  return { cx: sx / n / gw, cy: sy / n / gh };
}

/**
 * Spatial hash ile hızlandırılmış zincirleme.
 * O(n²) yerine O(n) ortalama: her nokta yalnızca komşu hücrelerde aranır.
 */
export function buildSpatialHash(points, cellSize) {
  const grid = new Map();
  for (let i = 0; i < points.length; i++) {
    const cx = Math.floor(points[i].x / cellSize);
    const cy = Math.floor(points[i].y / cellSize);
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  return grid;
}

export function neighborKeys(cx, cy) {
  const keys = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      keys.push(`${cx + dx},${cy + dy}`);
    }
  }
  return keys;
}

export function chainCues(cues, maxDist) {
  if (cues.length === 0) return [];
  if (cues.length === 1) return [];  // singleton → poligon değil

  // Spatial hash: noktaları hücrelere böl
  const hash = buildSpatialHash(cues, maxDist);
  const used = new Uint8Array(cues.length);
  const lines = [];

  // Pointer-based: array splice yerine used[] flag'ı — O(n) yerine O(1) kaldırma
  for (let start = cues.length - 1; start >= 0; start--) {
    if (used[start]) continue;
    used[start] = 1;
    const poly = [cues[start]];

    let grew = true;
    while (grew) {
      grew = false;
      const head = poly[0];
      const tail = poly[poly.length - 1];
      let bestI = -1;
      let bestD = maxDist;
      let atHead = false;

      // Spatial hash'ten komşu hücrelerdeki noktaları tara
      const hcx = Math.floor(head.x / maxDist);
      const hcy = Math.floor(head.y / maxDist);
      const tcx = Math.floor(tail.x / maxDist);
      const tcy = Math.floor(tail.y / maxDist);

      const searched = new Set();
      const searchCells = [...neighborKeys(hcx, hcy), ...neighborKeys(tcx, tcy)];
      for (const key of searchCells) {
        if (searched.has(key)) continue;
        searched.add(key);
        const cell = hash.get(key);
        if (!cell) continue;
        for (const i of cell) {
          if (used[i]) continue;
          const p = cues[i];
          const dh = Math.hypot(p.x - head.x, p.y - head.y);
          const dt = Math.hypot(p.x - tail.x, p.y - tail.y);
          if (dh < bestD) { bestD = dh; bestI = i; atHead = true; }
          if (dt < bestD) { bestD = dt; bestI = i; atHead = false; }
        }
      }

      if (bestI >= 0) {
        used[bestI] = 1;
        if (atHead) poly.unshift(cues[bestI]);
        else poly.push(cues[bestI]);
        grew = true;
      }
    }
    if (poly.length >= 2) lines.push(poly);
  }
  return lines;
}

function addPolyline(group, pts, mapW, mapD, sideView, color, y = -0.04) {
  if (!pts || pts.length < 2) return;
  const seq = pts.map((p) => {
    const w = mapToWorld(p.x, p.y, mapW, mapD, sideView);
    return new THREE.Vector3(w.x, y, w.z);
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(seq),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.92,
      fog: false,
    })
  );
  line.userData.band = "wall";
  group.add(line);
}

export const VOID_BANDS = new Set(["cyan", "blue", "purple"]);
export const POS_BANDS = new Set(["yellow", "orange", "red", "white", "hot"]);

function registerContact(g, rec, focusPos, radius) {
  state.freeDrawItems = state.freeDrawItems || [];
  state.freeDrawTargets = state.freeDrawTargets || {};
  const n = state.freeDrawItems.filter((i) => i.band === "contact").length + 1;
  const id = `fd-ct-${n}`;
  g.userData.focusId = id;
  g.userData.band = "contact";
  g.userData.viaBands = rec.via || [];
  const title = t("fd.contact");
  const item = {
    id,
    band: "contact",
    num: n,
    title,
    topM: rec.topM,
    dipM: rec.dipM,
    radius,
    hex: BANDS.contact.hex,
  };
  state.freeDrawItems.push(item);
  state.freeDrawTargets[id] = {
    position: focusPos.clone(),
    object: g,
    radius: Math.max(radius || 2, 1.2),
    title: `${n}. ${title}`,
    band: "contact",
    topM: rec.topM,
    dipM: rec.dipM,
  };
}

/** Ortak kenar → ince düşey şerit (boru değil). */
function addContactRibbon(group, pts, mapW, mapD, sideView, vertExag, rec) {
  if (!pts || pts.length < 2) return false;
  const ex = Math.max(Number(vertExag) || 1, 0.15);
  const y0 = -Math.max(rec.topM, 0.06) * ex;
  const y1 = -Math.max(rec.dipM, rec.topM + 0.4) * ex;
  if (y1 >= y0 - 0.05) return false;
  const world = pts.map((p) => mapToWorld(p.x, p.y, mapW, mapD, sideView));
  const minSeg = Math.max(mapW, mapD) / 900;
  const positions = [];
  const indices = [];
  const edge = [];
  for (let i = 0; i < world.length - 1; i++) {
    const a = world[i];
    const b = world[i + 1];
    if (Math.hypot(b.x - a.x, b.z - a.z) < minSeg) continue;
    const base = positions.length / 3;
    positions.push(a.x, y0, a.z, a.x, y1, a.z, b.x, y0, b.z, b.x, y1, b.z);
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    edge.push(new THREE.Vector3(a.x, y0, a.z));
  }
  if (world.length) edge.push(new THREE.Vector3(world[world.length - 1].x, y0, world[world.length - 1].z));
  if (indices.length < 6 || edge.length < 2) return false;
  const g = new THREE.Group();
  g.userData.band = "contact";
  g.userData.viaBands = rec.via || [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: 0xc9b46a,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    })
  );
  mesh.userData.band = "contact";
  mesh.userData.viaBands = rec.via || [];
  g.add(mesh);
  const cap = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(edge),
    new THREE.LineBasicMaterial({
      color: 0xe8d9a0,
      transparent: true,
      opacity: 0.9,
      fog: false,
    })
  );
  cap.userData.band = "contact";
  cap.userData.viaBands = rec.via || [];
  g.add(cap);
  const mid = edge[Math.floor(edge.length / 2)].clone();
  mid.y = (y0 + y1) * 0.5;
  const span = edge[0].distanceTo(edge[edge.length - 1]);
  registerContact(g, rec, mid, Math.max(span * 0.45, 1.3));
  group.add(g);
  return true;
}

function bandSpan(band, rangeM, vol) {
  if (vol && Number.isFinite(vol.topM) && Number.isFinite(vol.dipM)) {
    return { topM: vol.topM, dipM: vol.dipM };
  }
  const spec = BANDS[band];
  const topM = spec?.pool ? 0.08 : 0.12;
  const heightM = Math.max(0.7, (spec?.depthFrac || 0.3) * rangeM * 0.72);
  return { topM, dipM: topM + heightM };
}

function nearestBandVol(volumes, band, x, y) {
  let best = null;
  for (const v of volumes) {
    if (v.band !== band) continue;
    const d = Math.hypot(v.cx - x, v.cy - y);
    if (!best || d < best.d) best = { v, d };
  }
  return best && best.d < 0.28 ? best.v : null;
}

/** Maksimum bucket başına nokta sayısı — chainCues O(n²) olduğundan,
 *  büyük bucket'lar kritik darboğaz oluşturur. Bu limit hem bucket
 *  doldurma hem de zincirleme performansını sınırlar.
 */
const MAX_PTS_PER_BUCKET = 80;

/** Maksimum zincirleme girişimi (chainCues调用 sayısı) — büyük bucket'larda
 *  gereksiz sıralama ve splice.forEach önlemek için.
 */
const MAX_CHAIN_CUES_CALLS = 20;

function findAndAddContacts(group, volumes, pixelBand, gw, gh, mapW, mapD, sideView, vertExag, rangeM) {
  if (!pixelBand || !pixelBand.length) return 0;
  const owner = new Array(gw * gh);
  for (const v of volumes) {
    for (const k of v.cells || []) owner[k] = v;
  }
  const maxDim = Math.max(gw, gh);
  // Adaptif reach: küçük haritalarda daha geniş (daha fazla komşu tarar),
  //  büyük haritalarda daha dar (performans).
  const reach = Math.max(5, Math.min(14, Math.round(maxDim * 0.08)));

  // --- OPTİMİZASYON 1: Pre-build boundary pixel set ---
  // void piksellerinin yalnızca pozitif banda yakın olanlarını tara.
  // Bu, O(n × 8 × reach) yerine O(n_boundary × 8 × reach) çalışır.
  // Bir void pikseli "boundary" ise: 8 komşusundan en az biri pozitif band.
  const POS_SET = new Set(["yellow", "orange", "red", "white", "hot"]);
  const VOID_SET = VOID_BANDS;
  const boundaryPixels = [];
  const n4 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < gw * gh; i++) {
    if (!VOID_SET.has(pixelBand[i])) continue;
    const x = i % gw;
    const y = (i / gw) | 0;
    let isBoundary = false;
    for (const [dx, dy] of n4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const hb = pixelBand[ny * gw + nx];
      if (POS_SET.has(hb)) { isBoundary = true; break; }
    }
    if (isBoundary) boundaryPixels.push(i);
  }

  const dirs = n4; // aynı 8 yön
  const buckets = new Map();
  const seen = new Set();

  // --- OPTİMİZASYON 2: Sadece boundary piksellerini tara ---
  for (const i of boundaryPixels) {
    const vb = pixelBand[i];
    const x0 = i % gw;
    const y0 = (i / gw) | 0;
    for (const [dx, dy] of dirs) {
      for (let s = 1; s <= reach; s++) {
        const nx = x0 + dx * s;
        const ny = y0 + dy * s;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) break;
        const j = ny * gw + nx;
        const hb = pixelBand[j];
        if (!hb || hb === "skip") continue;
        if (VOID_SET.has(hb)) break;
        if (!POS_SET.has(hb)) break;
        const ek = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(ek)) break;
        seen.add(ek);
        const mx = (x0 + nx + 1) / (2 * gw);
        const my = (y0 + ny + 1) / (2 * gh);
        const voidVol = owner[i] || nearestBandVol(volumes, vb, mx, my);
        const posVol = owner[j] || nearestBandVol(volumes, hb, mx, my);
        const pair = `${voidVol?.id || vb}|${posVol?.id || hb}`;
        let bkt = buckets.get(pair);
        if (!bkt) {
          bkt = { voidBand: vb, posBand: hb, voidVol, posVol, pts: [] };
          buckets.set(pair, bkt);
        }
        // --- OPTİMİZASYON 3: Bucket slot limiti ---
        if (bkt.pts.length < MAX_PTS_PER_BUCKET) {
          bkt.pts.push({ x: mx, y: my });
        }
        break;
      }
    }
  }

  const cell = Math.max(0.07, 6 / maxDim);
  let n = 0;
  // Bucket'ları puanına göre sırala, yalnızca en iyi N'ini zincirle
  const ranked = [...buckets.values()]
    .sort((a, b) => b.pts.length - a.pts.length)
    .slice(0, MAX_CHAIN_CUES_CALLS);

  for (const bkt of ranked) {
    if (n >= 14) break;
    if (bkt.pts.length < 3) continue;
    const vs = bandSpan(bkt.voidBand, rangeM, bkt.voidVol);
    const ps = bandSpan(bkt.posBand, rangeM, bkt.posVol);
    const topM = Math.max(vs.topM, ps.topM);
    const dipM = Math.max(Math.min(vs.dipM, ps.dipM), topM + 0.7);
    const polys = chainCues(bkt.pts, cell).sort((a, b) => b.length - a.length);
    const poly = polys[0];
    if (!poly || poly.length < 2) continue;
    const step = Math.max(1, Math.floor(poly.length / 40));
    const slim = [];
    for (let i = 0; i < poly.length; i += step) slim.push(poly[i]);
    if (slim[slim.length - 1] !== poly[poly.length - 1]) slim.push(poly[poly.length - 1]);
    const ok = addContactRibbon(group, slim, mapW, mapD, sideView, vertExag, {
      topM,
      dipM,
      via: [bkt.voidBand, bkt.posBand],
    });
    if (ok) n += 1;
  }
  if (n === 0) {
    const voids = volumes.filter((v) => VOID_BANDS.has(v.band));
    const poss = volumes.filter((v) => POS_BANDS.has(v.band));
    for (const v of voids) {
      if (n >= 10) break;
      let best = null;
      for (const p of poss) {
        const d = Math.hypot(v.cx - p.cx, v.cy - p.cy);
        if (d < 0.02 || d > 0.28) continue;
        if (!best || d < best.d) best = { p, d };
      }
      if (!best) continue;
      const pts = [];
      for (const k of v.cells || []) {
        const x = ((k % gw) + 0.5) / gw;
        const y = (((k / gw) | 0) + 0.5) / gh;
        const sep = Math.hypot(v.cx - best.p.cx, v.cy - best.p.cy);
        if (Math.hypot(x - best.p.cx, y - best.p.cy) <= sep * 0.72) pts.push({ x, y });
      }
      if (pts.length < 4) continue;
      const vs = bandSpan(v.band, rangeM, v);
      const ps = bandSpan(best.p.band, rangeM, best.p);
      const topM = Math.max(vs.topM, ps.topM);
      const dipM = Math.max(Math.min(vs.dipM, ps.dipM), topM + 0.7);
      const polys = chainCues(pts, cell).sort((a, b) => b.length - a.length);
      const poly = polys[0];
      if (!poly || poly.length < 2) continue;
      const ok = addContactRibbon(group, poly, mapW, mapD, sideView, vertExag, {
        topM,
        dipM,
        via: [v.band, best.p.band],
      });
      if (ok) n += 1;
    }
  }
  return n;
}

function registerItem(g, spec, title, topM, heightM, radius) {
  if (!g || !spec?.id) return;
  state.freeDrawItems = state.freeDrawItems || [];
  state.freeDrawTargets = state.freeDrawTargets || {};
  const n = state.freeDrawItems.length + 1;
  const id = `fd-${spec.id}-${n}`;
  g.userData.focusId = id;
  g.userData.band = spec.id;
  const item = {
    id,
    band: spec.id,
    num: n,
    title,
    topM,
    dipM: topM + heightM,
    radius,
    hex: spec.hex,
  };
  state.freeDrawItems.push(item);
  state.freeDrawTargets[id] = {
    position: g.position.clone(),
    object: g,
    radius: Math.max(radius || 2, 1.2),
    title: `${n}. ${title}`,
    band: spec.id,
    topM,
    dipM: topM + heightM,
  };
}

function addBandVolume({
  group,
  cells,
  colors,
  heights,
  gw,
  gh,
  mapW,
  mapD,
  sideView,
  vertExag,
  wireframe,
  rangeM,
  spec,
  title,
}) {
  const outline = outlineFromCells(cells, gw, gh);
  if (!outline) return false;
  // outlineFromCells {x,y} nesne döndürür; makeFootprintVolume/sanitizeRing [x,y] dizi bekler.
  // Dönüşüm yapılmazsa tüm hacimler null → serbest çizim boş kalırdı.
  const ring = outline.map((p) => [p.x, p.y]);
  const { cx, cy } = centroidOfCells(cells, gw, gh);
  const { minH, maxAbs } = fieldSpan(cells, heights);
  const mag = Math.min(1, Math.max(maxAbs, Math.abs(minH), 0.22));
  const topM = spec.pool ? 0.08 : Math.max(0.12, (1 - mag) * 0.35);
  const heightM = Math.max(0.55, Math.min(rangeM - topM, spec.depthFrac * rangeM * (0.4 + 0.6 * mag)));
  const [r, g, b] = meanRgb(cells, colors);
  const built = makeFootprintVolume({
    outline: ring,
    mapW,
    mapD,
    sideView,
    cx,
    cy,
    topM,
    heightM,
    vertExag,
    wallColor: rgbInt(r, g, b),
    wireframe,
    rimColor: spec.rim,
    opacity: spec.opacity,
    poolFill: spec.pool,
  });
  if (!built) return false;
  built.group.userData.poolFill = spec.pool;
  registerItem(built.group, spec, title, topM, heightM, built.radius);
  group.add(built.group);
  return {
    id: built.group.userData.focusId,
    band: spec.id,
    cx,
    cy,
    topM,
    dipM: topM + heightM,
    cells,
    group: built.group,
  };
}

/**
 * Serbest çizim overlay: ELIC ara renkleri 3D + dip ölçü + deneysel kontak şeridi.
 * Analiz şablonlarını / DTO / su / metal pipeline'ını değiştirmez.
 */
export function buildFreeDrawOverlay(surface, mapW, mapD, vertExag, wireframe, sideView) {
  const group = new THREE.Group();
  group.name = "freeDrawOverlay";
  state.freeDrawItems = [];
  state.freeDrawTargets = {};
  state.selectedFreeDrawId = null;
  const gw = Math.max(2, Number(surface.gridW ?? surface.grid_w ?? 2));
  const gh = Math.max(2, Number(surface.gridH ?? surface.grid_h ?? 2));
  const colors = resolveColors(surface);
  const heights = surface.heights || [];
  const rangeM = depthRangeOf(surface);
  const need = gw * gh * 3;
  const minPx = adaptiveMinPx(gw, gh);
  let poolN = 0;
  let midN = 0;
  let redN = 0;
  let wallN = 0;
  let contactN = 0;
  const volumes = [];

  if (colors.length >= need) {
    const masks = {
      cyan: new Uint8Array(gw * gh),
      blue: new Uint8Array(gw * gh),
      purple: new Uint8Array(gw * gh),
      yellow: new Uint8Array(gw * gh),
      orange: new Uint8Array(gw * gh),
      red: new Uint8Array(gw * gh),
      white: new Uint8Array(gw * gh),
      hot: new Uint8Array(gw * gh),
    };
    const pixelBand = new Array(gw * gh);
    const whiteNearVoid = [];
    const voidish = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) {
      const o = i * 3;
      const r = colors[o] | 0;
      const g = colors[o + 1] | 0;
      const b = colors[o + 2] | 0;
      const band = bandOf(r, g, b);
      pixelBand[i] = band;
      if (masks[band]) masks[band][i] = 1;
      if (band === "cyan" || band === "blue" || band === "purple") voidish[i] = 1;
    }
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        const o = i * 3;
        if (!isWhite(colors[o], colors[o + 1], colors[o + 2])) continue;
        const neigh = voidish[i + 1] || voidish[i - 1] || voidish[i + gw] || voidish[i - gw];
        if (neigh) whiteNearVoid.push({ x: (x + 0.5) / gw, y: (y + 0.5) / gh });
      }
    }

    const order = ["purple", "blue", "cyan", "yellow", "orange", "red", "white", "hot"];
    for (const id of order) {
      const spec = BANDS[id];
      const blobs = blobsFromMask(masks[id], gw, gh, minPx).slice(0, spec.maxN);
      for (const cells of blobs) {
        const rec = addBandVolume({
          group,
          cells,
          colors,
          heights,
          gw,
          gh,
          mapW,
          mapD,
          sideView,
          vertExag,
          wireframe,
          rangeM,
          spec,
          title: t(spec.key),
        });
        if (!rec) continue;
        volumes.push(rec);
        if (id === "cyan" || id === "blue" || id === "purple") poolN += 1;
        else if (id === "red") redN += 1;
        else midN += 1;
      }
    }

    for (const poly of chainCues(whiteNearVoid, 0.045)) {
      addPolyline(group, poly, mapW, mapD, sideView, 0xf4f1e8, -0.05 * vertExag);
      wallN += 1;
    }
    contactN = findAndAddContacts(group, volumes, pixelBand, gw, gh, mapW, mapD, sideView, vertExag, rangeM);
    if (!contactN) {
      for (const poly of chainCues(whiteNearVoid, 0.05).slice(0, 8)) {
        if (poly.length < 2) continue;
        const ok = addContactRibbon(group, poly, mapW, mapD, sideView, vertExag, {
          topM: 0.1,
          dipM: Math.max(2.2, rangeM * 0.18),
          via: ["blue", "white"],
        });
        if (ok) contactN += 1;
      }
    }
  } else {
    for (const ch of surface.structures?.chambers || []) {
      if (ch.kind === "cavity") continue;
      const outline = planOutline(ch);
      if (!outline) continue;
      const topM = Number(ch.topFromSurfaceM ?? ch.top_from_surface_m ?? 0.08);
      const hM = Math.min(rangeM, Math.max(Number(ch.heightM ?? ch.height_m ?? 2), 1.1));
      const built = makeFootprintVolume({
        outline,
        mapW,
        mapD,
        sideView,
        cx: ch.cx,
        cy: ch.cy,
        topM,
        heightM: hM,
        vertExag,
        wallColor: 0x2a9ed0,
        wireframe,
        rimColor: 0xf4f1e8,
        opacity: 0.5,
        poolFill: true,
      });
      if (!built) continue;
      built.group.userData.poolFill = true;
      registerItem(built.group, BANDS.blue, t("sc.toneBlue"), topM, hM, built.radius);
      poolN += 1;
      group.add(built.group);
    }
  }

  const cues = surface.wallCues || surface.wall_cues || [];
  const voidCues = [];
  const lineCues = [];
  for (const c of cues) {
    const x = Number(c.x);
    const y = Number(c.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const p = { x, y };
    if (c.nearVoid || c.near_void) voidCues.push(p);
    else if (c.greenLine || c.green_line) lineCues.push(p);
  }
  for (const poly of chainCues(voidCues, 0.04)) {
    addPolyline(group, poly, mapW, mapD, sideView, 0xf7f4ea, -0.06 * vertExag);
    wallN += 1;
  }
  for (const poly of chainCues(lineCues, 0.035)) {
    addPolyline(group, poly, mapW, mapD, sideView, 0xffffff, -0.08 * vertExag);
    wallN += 1;
  }

  group.userData.counts = { poolN, midN, redN, wallN, contactN };
  return group;
}

export function bandEnabled(band) {
  if (!band) return true;
  const map = state.freeDrawBands || {};
  return map[band] !== false;
}

export function applyFreeDrawVisibility() {
  const free = !!state.useFootprintShape;
  const filled = state.poolFilled !== false;
  if (state.structureGroup) state.structureGroup.visible = !free || !filled;
  if (state.freeDrawGroup) {
    state.freeDrawGroup.visible = free;
    state.freeDrawGroup.traverse((obj) => {
      const band = obj.userData?.band;
      if (band === "contact") {
        const via = obj.userData.viaBands || [];
        obj.visible = bandEnabled("contact") && via.every((b) => !b || bandEnabled(b));
        return;
      }
      if (band && !bandEnabled(band)) {
        obj.visible = false;
        return;
      }
      if (obj.userData && obj.userData.poolFill) obj.visible = filled;
      else if (band) obj.visible = true;
    });
  }
  invalidate();
}
