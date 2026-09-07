/**
 * clustering.js — Otomatik anomali kümeleme.
 *
 * DBSCAN algoritmasıyla tespit edilen yapıları otomatik gruplar.
 * "Bu 3 tespit aynı yapıya ait olabilir" önerileri üretir.
 *
 * Kullanım:
 *   import { clusterStructures, getClusterStats } from "./clustering.js";
 *   const clusters = clusterStructures(chambers, tunnels, metals, { eps: 5, minPts: 2 });
 */

/**
 * İki nokta arasındaki 3D Öklid mesafesi.
 */
function dist3D(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * İki nokta arasındaki yatay (XZ) mesafe.
 */
function distXZ(a, b) {
  const dx = (a.x || 0) - (b.x || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * DBSCAN kümeleme algoritması.
 *
 * @param {Array<{x: number, y: number, z: number}>} points — Noktalar
 * @param {number} eps — Komşuluk yarıçapı (metre)
 * @param {number} minPts — Minimum küme büyüklüğü
 * @param {function} [distFn=distXZ] — Mesafe fonksiyonu
 * @returns {Array<{points: Array, centroid: {x,y,z}, radius: number}>}
 */
export function dbscan(points, eps, minPts, distFn = distXZ) {
  if (!points?.length) return [];

  const n = points.length;
  const labels = new Array(n).fill(-1); // -1 = işlenmedi, -2 = gürültü
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;

    // Komşuları bul
    const neighbors = [];
    for (let j = 0; j < n; j++) {
      if (distFn(points[i], points[j]) <= eps) {
        neighbors.push(j);
      }
    }

    if (neighbors.length < minPts) {
      labels[i] = -2; // gürültü
      continue;
    }

    // Yeni küme
    labels[i] = clusterId;
    const queue = [...neighbors];
    const visited = new Set([i]);

    while (queue.length > 0) {
      const idx = queue.shift();
      if (visited.has(idx)) continue;
      visited.add(idx);

      if (labels[idx] === -2) labels[idx] = clusterId; // gürültü noktasını kümeye al
      if (labels[idx] !== -1) continue;

      labels[idx] = clusterId;

      // Bu noktanın da komşularını kontrol et
      const subNeighbors = [];
      for (let k = 0; k < n; k++) {
        if (distFn(points[idx], points[k]) <= eps) {
          subNeighbors.push(k);
        }
      }
      if (subNeighbors.length >= minPts) {
        for (const nn of subNeighbors) {
          if (!visited.has(nn)) queue.push(nn);
        }
      }
    }

    clusterId++;
  }

  // Kümeleri topla
  const clusters = [];
  for (let c = 0; c < clusterId; c++) {
    const memberPoints = points.filter((_, i) => labels[i] === c);
    if (memberPoints.length === 0) continue;

    // Centroid
    const cx = memberPoints.reduce((s, p) => s + (p.x || 0), 0) / memberPoints.length;
    const cy = memberPoints.reduce((s, p) => s + (p.y || 0), 0) / memberPoints.length;
    const cz = memberPoints.reduce((s, p) => s + (p.z || 0), 0) / memberPoints.length;

    // Yarıçap — centroid'den en uzak nokta
    let maxR = 0;
    for (const p of memberPoints) {
      const d = dist3D(p, { x: cx, y: cy, z: cz });
      if (d > maxR) maxR = d;
    }

    clusters.push({
      id: c,
      points: memberPoints,
      centroid: { x: cx, y: cy, z: cz },
      radius: maxR,
      size: memberPoints.length,
    });
  }

  return clusters;
}

/**
 * Tespit edilen yapıları kümele.
 *
 * @param {Array} chambers — Oda tespitleri
 * @param {Array} tunnels — Tünel tespitleri
 * @param {Array} metals — Metal tespitleri
 * @param {Object} [options]
 * @param {number} [options.eps=8] — DBSCAN eps (metre)
 * @param {number} [options.minPts=2] — Minimum küme büyüklüğü
 * @returns {Array<{id, type, label, members, centroid, radius, suggestion}>}
 */
export function clusterStructures(chambers = [], tunnels = [], metals = [], options = {}) {
  const eps = options.eps ?? 8;
  const minPts = options.minPts ?? 2;

  // Tüm yapıları tek listeye çevir
  const allStructures = [];

  for (const ch of chambers) {
    allStructures.push({
      x: ch.x ?? ch.cx ?? 0,
      y: ch.y ?? ch.cy ?? 0,
      z: ch.z ?? ch.cz ?? 0,
      kind: ch.kind || "room",
      label: ch.label || `${ch.num || "?"}`,
      confidence: ch.confidence ?? 0,
      index: allStructures.length,
    });
  }

  for (const t of tunnels) {
    allStructures.push({
      x: t.x ?? t.cx ?? 0,
      y: t.y ?? t.cy ?? 0,
      z: t.z ?? t.cz ?? 0,
      kind: "tunnel",
      label: t.label || `${t.num || "?"}`,
      confidence: t.confidence ?? 0,
      index: allStructures.length,
    });
  }

  for (const m of metals) {
    allStructures.push({
      x: m.x ?? m.cx ?? 0,
      y: m.y ?? m.cy ?? 0,
      z: m.z ?? m.cz ?? 0,
      kind: "metal",
      label: m.label || `${m.num || "?"}`,
      confidence: m.confidence ?? 0,
      index: allStructures.length,
    });
  }

  if (allStructures.length < minPts) return [];

  // DBSCAN çalıştır
  const rawClusters = dbscan(allStructures, eps, minPts);

  // Anlamlı kümeler üret
  return rawClusters.map((cl) => {
    const kinds = {};
    let totalConf = 0;
    for (const p of cl.points) {
      kinds[p.kind] = (kinds[p.kind] || 0) + 1;
      totalConf += p.confidence;
    }

    const dominantKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] || "mixed";
    const kindEmoji = dominantKind === "room" ? "🟦" : dominantKind === "tunnel" ? "🟢" : dominantKind === "metal" ? "🔴" : "🔗";

    let suggestion = "";
    if (cl.size >= 3 && dominantKind === "room") {
      suggestion = `${cl.size} oda birbirine yakın — Equals mağara kompleksi olabilir`;
    } else if (cl.size >= 2 && dominantKind === "tunnel") {
      suggestion = `${cl.size} tünel birleşik — Tünel ağı olabilir`;
    } else if (dominantKind === "metal") {
      suggestion = `${cl.size} metal kaynağı yakınlarda — Büyük metal yapı olabilir`;
    } else if (cl.size >= 2) {
      suggestion = `${cl.size} farklı yapı yakınlarda`;
    }

    return {
      id: cl.id,
      type: dominantKind,
      label: `${kindEmoji} Küme #${cl.id + 1}`,
      members: cl.points.map((p) => ({
        label: p.label,
        kind: p.kind,
        confidence: p.confidence,
      })),
      centroid: cl.centroid,
      radius: cl.radius,
      size: cl.size,
      avgConfidence: Math.round((totalConf / cl.points.length) * 100),
      suggestion,
    };
  });
}

/**
 * Küme istatistikleri — sağ panel için özet.
 */
export function getClusterStats(clusters) {
  if (!clusters?.length) {
    return { total: 0, members: 0, avgRadius: 0, types: {} };
  }

  const types = {};
  let totalMembers = 0;
  let totalRadius = 0;

  for (const cl of clusters) {
    types[cl.type] = (types[cl.type] || 0) + 1;
    totalMembers += cl.size;
    totalRadius += cl.radius;
  }

  return {
    total: clusters.length,
    members: totalMembers,
    avgRadius: Math.round((totalRadius / clusters.length) * 10) / 10,
    types,
  };
}

/**
 * Kümeleme sonuçlarını HTML olarak formatla — sağ panel için.
 */
export function formatClusterHTML(clusters) {
  if (!clusters?.length) {
    return '<div style="color:var(--muted);font-size:0.6rem;">Kümeleme sonucu yok — en az 2 yapı gerekli.</div>';
  }

  const stats = getClusterStats(clusters);
  let html = `
    <div style="font-size:0.6rem;color:var(--muted);margin-bottom:0.3rem;">
      ${stats.total} küme · ${stats.members} yapı · Ort. yarıçap: ${stats.avgRadius}m
    </div>
  `;

  for (const cl of clusters) {
    const confColor = cl.avgConfidence >= 70 ? "#22c55e" : cl.avgConfidence >= 40 ? "#eab308" : "#ef4444";
    html += `
      <div style="background:var(--bg2);border:1px solid var(--line);border-radius:6px;padding:0.4rem;margin-bottom:0.3rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.2rem;">
          <span style="font-size:0.65rem;font-weight:700;color:var(--text);">${cl.label}</span>
          <span style="font-size:0.55rem;background:${confColor};color:#000;padding:1px 6px;border-radius:8px;">${cl.avgConfidence}% güven</span>
        </div>
        <div style="font-size:0.55rem;color:var(--muted);margin-bottom:0.2rem;">
          Merkez: ${cl.centroid.x.toFixed(1)}, ${cl.centroid.y.toFixed(1)}, ${cl.centroid.z.toFixed(1)} m
          · Yarıçap: ${cl.radius.toFixed(1)}m
        </div>
        <div style="font-size:0.55rem;color:var(--text);">
          ${cl.members.map((m) => {
            const emoji = m.kind === "room" ? "🟦" : m.kind === "tunnel" ? "🟢" : m.kind === "metal" ? "🔴" : "⬛";
            return `${emoji} ${m.label}`;
          }).join(" · ")}
        </div>
        ${cl.suggestion ? `<div style="font-size:0.55rem;color:#22c55e;margin-top:0.2rem;">💡 ${cl.suggestion}</div>` : ""}
      </div>
    `;
  }

  return html;
}
