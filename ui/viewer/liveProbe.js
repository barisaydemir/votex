/**
 * liveProbe.js — 3D Sahne Üzerinde Canlı Koordinat Okuma
 *
 * Mouse'un altındaki 3D noktanın XYZ koordinatlarını ve
 * en yakın manyetik değeri anlık olarak gösterir.
 *
 * İki gösterim:
 *   1. Cursor yanında floating etiket (hızlı okuma)
 *   2. Status bar'da sürekli güncellenen okuma alanı
 *
 * Kullanım:
 *   import { initLiveProbe } from "./liveProbe.js";
 *   initLiveProbe(renderer, scene, camera);
 */
import * as THREE from "three";
import { state } from "../app/state.js";
import { invalidate } from "./scene.js";

// ── Durum ──
let _raycaster = new THREE.Raycaster();
let _mouse = new THREE.Vector2();
let _labelEl = null;
let _statusEl = null;
let _canvas = null;
let _bound = false;
let _throttleId = null;
let _lastProbe = null;
let _hidden = false;

const THROTTLE_MS = 33; // ~30fps probe hızı

// ── Başlatma ──

/**
 * Canlı probe sistemini başlat.
 * Viewer canvas'a mousemove bağlar, floating label + status bar alanını oluşturur.
 *
 * @param {HTMLElement} hostEl - #viewer div
 */
export function initLiveProbe(hostEl) {
  if (_bound) destroy();

  _canvas = hostEl?.querySelector("canvas");
  if (!_canvas) {
    console.warn("[LiveProbe] Canvas bulunamadı");
    return;
  }

  _createLabel(hostEl);
  _createStatusBar();

  _canvas.addEventListener("mousemove", _onMouseMove);
  _canvas.addEventListener("mouseleave", _onMouseLeave);
  _canvas.addEventListener("mouseenter", _onMouseEnter);
  _bound = true;

  console.log("[LiveProbe] Başlatıldı");
}

/**
 * Temizleme.
 */
export function destroy() {
  if (!_canvas) return;
  _canvas.removeEventListener("mousemove", _onMouseMove);
  _canvas.removeEventListener("mouseleave", _onMouseLeave);
  _canvas.removeEventListener("mouseenter", _onMouseEnter);
  if (_labelEl) { _labelEl.remove(); _labelEl = null; }
  if (_statusEl) { _statusEl.remove(); _statusEl = null; }
  if (_throttleId) { cancelAnimationFrame(_throttleId); _throttleId = null; }
  _canvas = null;
  _bound = false;
  _lastProbe = null;
}

/**
 * Probe görünürlüğünü aç/kapa.
 */
export function setProbeVisible(on) {
  _hidden = !on;
  if (_labelEl) _labelEl.style.display = "none";
}

// ── DOM Oluşturma ──

function _createLabel(hostEl) {
  if (_labelEl) _labelEl.remove();
  _labelEl = document.createElement("div");
  _labelEl.id = "live-probe-label";
  Object.assign(_labelEl.style, {
    position: "absolute",
    display: "none",
    background: "rgba(10,16,24,0.92)",
    border: "1px solid rgba(62,220,140,0.4)",
    borderRadius: "6px",
    padding: "5px 8px",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.62rem",
    color: "#c8d8c8",
    pointerEvents: "none",
    zIndex: "100",
    whiteSpace: "pre-line",
    lineHeight: "1.4",
    backdropFilter: "blur(6px)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
    maxWidth: "220px",
    transition: "opacity 0.15s ease",
  });
  hostEl.appendChild(_labelEl);
}

function _createStatusBar() {
  if (_statusEl) _statusEl.remove();

  // Stage hud varsa oraya, yoksa viewer altına ekle
  const hud = document.getElementById("stage-hud");
  const host = hud || document.getElementById("viewer")?.parentElement;

  _statusEl = document.createElement("div");
  _statusEl.id = "live-probe-status";
  Object.assign(_statusEl.style, {
    position: "fixed",
    bottom: "28px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(10,16,24,0.88)",
    border: "1px solid rgba(62,220,140,0.2)",
    borderRadius: "8px",
    padding: "4px 14px",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.68rem",
    color: "#8ea8b8",
    pointerEvents: "none",
    zIndex: "99",
    display: "none",
    whiteSpace: "nowrap",
    backdropFilter: "blur(6px)",
    transition: "opacity 0.2s ease",
    letterSpacing: "0.03em",
  });
  document.body.appendChild(_statusEl);
}

// ── Event Handlers ──

function _onMouseMove(e) {
  if (_hidden || _throttleId) return;
  _throttleId = requestAnimationFrame(() => {
    _throttleId = null;
    _doProbe(e);
  });
}

function _onMouseEnter() {
  if (_statusEl) { _statusEl.style.display = "block"; _statusEl.style.opacity = "1"; }
}

function _onMouseLeave() {
  if (_labelEl) _labelEl.style.display = "none";
  if (_statusEl) { _statusEl.style.opacity = "0"; setTimeout(() => { if (_statusEl) _statusEl.style.display = "none"; }, 200); }
}

// ── Raycast Probe ──

function _doProbe(e) {
  const camera = state.camera;
  const scene = state.scene;
  const renderer = state.renderer;
  if (!camera || !scene || !renderer || !_canvas) return;

  // Mouse normalized device coordinates
  const rect = _canvas.getBoundingClientRect();
  _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  _raycaster.setFromCamera(_mouse, camera);

  // Sahne üzerindeki intersection'ları bul
  const intersects = _raycaster.intersectObjects(scene.children, true);
  if (!intersects || intersects.length === 0) {
    _hideLabel();
    _lastProbe = null;
    return;
  }

  // İlk geçerli hit
  const hit = intersects[0];
  const point = hit.point;

  // XYZ koordinatları
  const x = point.x;
  const y = point.y;
  const z = point.z;

  // ── Yapı tespiti (metal/oda/tünel) ──
  let structInfo = null;
  let structKind = null;
  const hitObj = hit.object;
  if (hitObj?.userData?.csvStructure) {
    const s = hitObj.userData.csvStructure;
    structKind = hitObj.userData.csvKind || "structure";
    structInfo = {
      kind: structKind,
      label: s.label || s.guess || s.cue || structKind,
      cx: Number(s.cx) || 0,
      cy: Number(s.cy) || 0,
      depthM: Number(s.depthFromSurfaceM ?? s.depth_from_surface_m ?? 0),
      widthM: Number(s.widthM ?? s.width_m ?? 0),
      lengthM: Number(s.lengthM ?? s.length_m ?? 0),
      spreadM: Number(s.spreadM ?? s.spread_m ?? 0),
      magnetic: Number(s.magnetic ?? s.fieldStrength ?? 0),
      confidence: Number(s.confidence ?? s.score ?? 0),
      neden: s.neden || s.reason || "",
    };
  }

  // En yakın manyetik değeri bul (CSV overlay varsa)
  let magnetic = null;
  let magneticSource = null;
  let nearestDist = Infinity;
  let nearestPoint = null;

  const csvOverlay = state.csvOverlay;
  if (csvOverlay?.userData?.csvPoints) {
    const normPoints = csvOverlay.userData.csvPoints;
    const normCenter = csvOverlay.userData.normCenter;
    const anomalyStats = csvOverlay.userData.anomalyStats;

    // Normalize → metre dönüşüm parametreleri
    const dims = anomalyStats?.dims;
    if (dims && normCenter) {
      const halfW = dims.w / 2;
      const halfD = dims.d / 2;

      for (let i = 0; i < normPoints.length; i++) {
        const p = normPoints[i];
        const pwx = p.x;
        const pwz = p.z;
        const dx = pwx - x;
        const dz = pwz - z;
        const d2 = dx * dx + dz * dz;
        if (d2 < nearestDist) {
          nearestDist = d2;
          magnetic = p.magnetic ?? p.anomaly ?? null;
          magneticSource = "csv";
          nearestPoint = p;
        }
      }
    }
  }

  // Image grid'den de manyetik oku (hybrid modda)
  if (magnetic === null && state.surfaceState?.imageGrid) {
    const grid = state.surfaceState.imageGrid;
    const gridRes = state.surfaceState.gridRes || 64;
    const gx = Math.round(Math.max(0, Math.min(gridRes - 1, (x / (state.surfaceState.mapWidthM || 24) + 0.5) * gridRes)));
    const gz = Math.round(Math.max(0, Math.min(gridRes - 1, (z / (state.surfaceState.mapDepthM || 24) + 0.5) * gridRes)));
    const idx = gz * gridRes + gx;
    if (idx >= 0 && idx < grid.length && grid[idx]?.nT !== undefined) {
      magnetic = grid[idx].nT;
      magneticSource = "image";
    }
  }

  // ── Yapıya özel detay (metal/oda/tünel) ──
  let structDetail = null;
  if (structInfo) {
    const cx = structInfo.cx;
    const cz = structInfo.cy;
    const depthM = structInfo.depthM;
    const wM = structInfo.widthM;
    const lM = structInfo.lengthM;
    const spreadM = structInfo.spreadM;
    const mag = structInfo.magnetic;
    const conf = structInfo.confidence;

    // Anomali merkezi → yüzey noktası
    const surfacePt = { x: cx.toFixed(2), z: cz.toFixed(2) };
    const anomalyCenter = { x: cx.toFixed(2), y: (-depthM).toFixed(2), z: cz.toFixed(2) };

    // Yüzeye en yakın nokta (raycast yüzey noktası)
    const surfaceHit = { x: x.toFixed(2), y: "0.00", z: z.toFixed(2) };

    // Mesafe: yüzey noktası ile anomali merkezi arası
    const distToSurface = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2).toFixed(2);

    structDetail = {
      kind: structKind,
      label: structInfo.label,
      surfacePt,
      anomalyCenter,
      surfaceHit,
      depthM: depthM.toFixed(2),
      widthM: wM.toFixed(2),
      lengthM: lM.toFixed(2),
      spreadM: spreadM.toFixed(2),
      magnetic: mag ? mag.toFixed(1) : "—",
      confidence: conf ? (conf * 100).toFixed(0) + "%" : "—",
      distToSurface,
      neden: structInfo.neden,
    };
  }

  // Probe sonucu
  const probe = {
    x: x.toFixed(2),
    y: y.toFixed(2),
    z: z.toFixed(2),
    magnetic: magnetic !== null ? (typeof magnetic === "number" ? magnetic.toFixed(1) : magnetic) : "—",
    magneticSource,
    distance: Math.sqrt(nearestDist).toFixed(2),
    objectName: hit.object?.name || "",
    structKind,
    structDetail,
    nearestCsvPoint: nearestPoint ? {
      x: nearestPoint.x?.toFixed(2),
      z: nearestPoint.z?.toFixed(2),
      mag: (nearestPoint.magnetic ?? nearestPoint.anomaly)?.toFixed(1),
      depth: nearestPoint.y?.toFixed(2),
    } : null,
  };

  _lastProbe = probe;

  // Floating label güncelle
  _updateLabel(e.clientX, e.clientY, probe);

  // Status bar güncelle
  _updateStatusBar(probe);
}

function _updateLabel(cx, cy, probe) {
  if (!_labelEl) return;

  const magColor = probe.magneticSource === "csv" ? "#e85858" :
    probe.magneticSource === "image" ? "#5888e8" : "#666";

  let html = ``;

  // Temel XYZ + Manyetik
  html += `<span style="color:#3edc8c;font-weight:600;">XYZ</span> `;
  html += `<span style="color:#e0e0e0;">${probe.x}, ${probe.y}, ${probe.z}</span> m`;
  if (probe.magnetic !== "—") {
    html += `\n<span style="color:${magColor};font-weight:600;">B</span> `;
    html += `<span style="color:#e0e0e0;">${probe.magnetic} nT</span>`;
    html += `<span style="color:#555;font-size:0.52rem;"> (${probe.magneticSource})</span>`;
  }

  // Yapıya özel detay (metal/oda/tünel)
  if (probe.structDetail) {
    const sd = probe.structDetail;
    const kindEmoji = sd.kind === "metal" ? "🔴" : sd.kind === "chamber" ? "🟦" : "🟢";
    const kindLabel = sd.kind === "metal" ? "METAL" : sd.kind === "chamber" ? "ODA" : "TÜNEL";

    html += `\n<span style="color:#ffd27a;font-weight:600;">${kindEmoji} ${kindLabel}</span> <span style="color:#888;">${sd.label}</span>`;

    // Anomali merkezi
    html += `\n<span style="color:#555;">Merkez:</span> <span style="color:#e0e0e0;">${sd.anomalyCenter.x}, ${sd.anomalyCenter.y}, ${sd.anomalyCenter.z}</span> m`;

    // Yüzey noktası
    html += `\n<span style="color:#555;">Yüzey:</span> <span style="color:#3edc8c;">${sd.surfacePt.x}, 0, ${sd.surfacePt.z}</span> m`;

    // Derinlik + Boyut
    html += `\n<span style="color:#555;">Derinlik:</span> <span style="color:#e0e0e0;">${sd.depthM}m</span>`;
    if (sd.widthM !== "0.00") html += ` <span style="color:#555;">Genişlik:</span> <span style="color:#e0e0e0;">${sd.widthM}m</span>`;
    if (sd.lengthM !== "0.00") html += ` <span style="color:#555;">Uzunluk:</span> <span style="color:#e0e0e0;">${sd.lengthM}m</span>`;

    // Manyetik + Güven
    if (sd.magnetic !== "—") html += `\n<span style="color:#e85858;">Manyetik:</span> <span style="color:#e0e0e0;">${sd.magnetic} nT</span>`;
    if (sd.confidence !== "—") html += ` <span style="color:#555;">Güven:</span> <span style="color:#eab308;">${sd.confidence}</span>`;

    // Mesafe: cursor ile anomali merkezi arası
    html += `\n<span style="color:#555;">Merkeze uzaklık:</span> <span style="color:#e0e0e0;">${sd.distToSurface}m</span>`;
  } else if (probe.nearestCsvPoint) {
    // Yapı değil ama en yakın CSV noktası var
    const np = probe.nearestCsvPoint;
    html += `\n<span style="color:#555;">En yakın nokta:</span> <span style="color:#e0e0e0;">(${np.x}, ${np.z}) derinlik:${np.depth}m</span>`;
  }

  _labelEl.innerHTML = html;

  // Label pozisyonu (cursor sağ üstünde)
  const labelW = 240;
  const labelH = probe.structDetail ? 140 : 36;
  let lx = cx + 16;
  let ly = cy - labelH - 4;

  if (lx + labelW > window.innerWidth) lx = cx - labelW - 16;
  if (ly < 0) ly = cy + 16;

  _labelEl.style.left = lx + "px";
  _labelEl.style.top = ly + "px";
  _labelEl.style.display = "block";
  _labelEl.style.opacity = "1";
}

function _hideLabel() {
  if (_labelEl) _labelEl.style.opacity = "0";
}

function _updateStatusBar(probe) {
  if (!_statusEl) return;

  const magColor = probe.magneticSource === "csv" ? "#e85858" :
    probe.magneticSource === "image" ? "#5888e8" : "#666";

  let html =
    `<span style="color:#3edc8c;">⊕</span> ` +
    `<span style="color:#555;">X:</span><span style="color:#e0e0e0;">${probe.x}</span> ` +
    `<span style="color:#555;">Y:</span><span style="color:#e0e0e0;">${probe.y}</span> ` +
    `<span style="color:#555;">Z:</span><span style="color:#e0e0e0;">${probe.z}</span> ` +
    `<span style="color:#444;">│</span> ` +
    `<span style="color:${magColor};">B:</span><span style="color:#e0e0e0;">${probe.magnetic} nT</span>`;

  // Yapı bilgisi (status bar)
  if (probe.structDetail) {
    const sd = probe.structDetail;
    const kindLabel = sd.kind === "metal" ? "🔴METAL" : sd.kind === "chamber" ? "🟦ODA" : "🟢TÜNEL";
    html += ` <span style="color:#444;">│</span> `;
    html += `<span style="color:#ffd27a;font-weight:600;">${kindLabel}</span> `;
    html += `<span style="color:#888;">${sd.label}</span> `;
    html += `<span style="color:#555;">D:</span><span style="color:#e0e0e0;">${sd.depthM}m</span> `;
    html += `<span style="color:#555;">M:</span><span style="color:#e85858;">${sd.magnetic}nT</span> `;
    html += `<span style="color:#555;">G:</span><span style="color:#eab308;">${sd.confidence}</span>`;
  }

  _statusEl.innerHTML = html;
}

// ── Public API ──

/**
 * Son probe sonucunu döndür.
 */
export function getLastProbe() {
  return _lastProbe;
}
