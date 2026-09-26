/**
 * filterPanel.js — Veri filtreleme paneli.
 *
 * CSV verisi yüklendiğinde:
 *   • Manyetik yoğunluk aralığı (nT)
 *   • Derinlik aralığı (m)
 *   • Koordinat bounding box
 *   • Yapı türü filtresi (Oda / Tünel / Metal)
 *
 * Filtreler uygulandığında state.csvData'ya filtered
 * harmedisi eklenir ve sahne yeniden oluşturulur.
 */
import { state } from "../app/state.js";

/** Aktif filtre durumu */
export const filterState = {
  magMin: -Infinity,
  magMax: Infinity,
  depthMin: -Infinity,
  depthMax: Infinity,
  xMin: -Infinity,
  xMax: Infinity,
  zMin: -Infinity,
  zMax: Infinity,
  kinds: new Set(["room", "tunnel", "metal", "shaft"]),
  enabled: false,
};

/**
 * CSV verisini mevcut filtrelerle süz.
 * @param {Array} rows — CSV satırları (objects)
 * @returns {Array} Filtrelenmiş satırlar
 */
export function filterCsvRows(rows) {
  if (!filterState.enabled || !rows?.length) return rows || [];

  return rows.filter((r) => {
    // Manyetik aralık
    const mag = Number(r.mag ?? r.magnetic ?? r.z ?? 0);
    if (mag < filterState.magMin || mag > filterState.magMax) return false;

    // Derinlik aralığı
    const y = Number(r.y ?? r.depth ?? 0);
    if (y < filterState.depthMin || y > filterState.depthMax) return false;

    // Koordinat aralığı
    const x = Number(r.x ?? 0);
    const z = Number(r.z2 ?? r.z ?? 0);
    if (x < filterState.xMin || x > filterState.xMax) return false;
    if (z < filterState.zMin || z > filterState.zMax) return false;

    return true;
  });
}

/**
 * Tespit edilen yapıları türüne göre filtrele.
 * @param {Object} stats — analiz sonuçları { chambers, tunnels, metals, ... }
 * @returns {Object} Filtrelenmiş sonuçlar
 */
export function filterStructures(stats) {
  if (!filterState.enabled || !stats) return stats;

  const kinds = filterState.kinds;
  return {
    ...stats,
    chambers: (stats.chambers || []).filter((ch) => kinds.has(ch.kind || "room")),
    tunnels: (stats.tunnels || []).filter((t) => kinds.has("tunnel")),
    metals: (stats.metals || []).filter(() => kinds.has("metal")),
    shafts: (stats.shafts || []).filter(() => kinds.has("shaft")),
  };
}

/**
 * UI'ı render et — filterPanel container'ına.
 */
export function renderFilterPanel() {
  const container = document.getElementById("filter-panel-content");
  if (!container) return;

  const hasData = !!(state.csvData || state.surfaceState);

  container.innerHTML = `
    <div style="font-size:0.65rem;color:var(--muted);margin-bottom:0.5rem;">
      ${hasData ? "Filtreleri ayarlayıp «FİLTRELE» butonuna basın." : "Veri yüklendiğinde filtreler aktif olur."}
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;margin-bottom:0.5rem;">
      <label style="font-size:0.6rem;color:var(--muted);">
        Min Manyetik (nT)
        <input type="number" id="filter-mag-min" value="${filterState.magMin === -Infinity ? '' : filterState.magMin}"
          placeholder="∞" style="width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);padding:2px 4px;border-radius:3px;font-size:0.6rem;" />
      </label>
      <label style="font-size:0.6rem;color:var(--muted);">
        Max Manyetik (nT)
        <input type="number" id="filter-mag-max" value="${filterState.magMax === Infinity ? '' : filterState.magMax}"
          placeholder="∞" style="width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);padding:2px 4px;border-radius:3px;font-size:0.6rem;" />
      </label>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.4rem;margin-bottom:0.5rem;">
      <label style="font-size:0.6rem;color:var(--muted);">
        Min Derinlik (m)
        <input type="number" id="filter-depth-min" value="${filterState.depthMin === -Infinity ? '' : filterState.depthMin}"
          placeholder="∞" style="width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);padding:2px 4px;border-radius:3px;font-size:0.6rem;" />
      </label>
      <label style="font-size:0.6rem;color:var(--muted);">
        Max Derinlik (m)
        <input type="number" id="filter-depth-max" value="${filterState.depthMax === Infinity ? '' : filterState.depthMax}"
          placeholder="∞" style="width:100%;background:var(--bg2);border:1px solid var(--line);color:var(--text);padding:2px 4px;border-radius:3px;font-size:0.6rem;" />
      </label>
    </div>

    <div style="margin-bottom:0.5rem;">
      <div style="font-size:0.6rem;color:var(--muted);margin-bottom:0.2rem;">Yapı Türü</div>
      <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
        <label style="font-size:0.58rem;color:var(--text);display:flex;align-items:center;gap:2px;">
          <input type="checkbox" id="filter-kind-room" ${filterState.kinds.has("room") ? "checked" : ""} /> 🟦 Oda
        </label>
        <label style="font-size:0.58rem;color:var(--text);display:flex;align-items:center;gap:2px;">
          <input type="checkbox" id="filter-kind-tunnel" ${filterState.kinds.has("tunnel") ? "checked" : ""} /> 🟢 Tünel
        </label>
        <label style="font-size:0.58rem;color:var(--text);display:flex;align-items:center;gap:2px;">
          <input type="checkbox" id="filter-kind-metal" ${filterState.kinds.has("metal") ? "checked" : ""} /> 🔴 Metal
        </label>
        <label style="font-size:0.58rem;color:var(--text);display:flex;align-items:center;gap:2px;">
          <input type="checkbox" id="filter-kind-shaft" ${filterState.kinds.has("shaft") ? "checked" : ""} /> ⬛ Şaft
        </label>
      </div>
    </div>

    <div style="display:flex;gap:0.4rem;">
      <button id="filter-apply" style="flex:1;padding:4px 8px;background:#0d6efd;color:#fff;border:none;border-radius:4px;font-size:0.62rem;cursor:pointer;"
        ${!hasData ? "disabled" : ""}>🔍 FİLTRELE</button>
      <button id="filter-reset" style="flex:1;padding:4px 8px;background:var(--bg2);color:var(--muted);border:1px solid var(--line);border-radius:4px;font-size:0.62rem;cursor:pointer;">
        ↩ SIFIRLA</button>
    </div>

    <div id="filter-status" style="margin-top:0.3rem;font-size:0.58rem;color:var(--muted);"></div>
  `;

  // Event binding
  container.querySelector("#filter-apply")?.addEventListener("click", applyFilters);
  container.querySelector("#filter-reset")?.addEventListener("click", resetFilters);
}

function applyFilters() {
  const v = (id) => {
    const el = document.getElementById(id);
    const v = el?.value?.trim();
    if (v === "" || v === undefined) return undefined;
    return Number(v);
  };

  filterState.magMin = v("filter-mag-min") ?? -Infinity;
  filterState.magMax = v("filter-mag-max") ?? Infinity;
  filterState.depthMin = v("filter-depth-min") ?? -Infinity;
  filterState.depthMax = v("filter-depth-max") ?? Infinity;
  filterState.enabled = true;

  // Tür filtresi
  filterState.kinds.clear();
  if (document.getElementById("filter-kind-room")?.checked) filterState.kinds.add("room");
  if (document.getElementById("filter-kind-tunnel")?.checked) filterState.kinds.add("tunnel");
  if (document.getElementById("filter-kind-metal")?.checked) filterState.kinds.add("metal");
  if (document.getElementById("filter-kind-shaft")?.checked) filterState.kinds.add("shaft");

  const status = document.getElementById("filter-status");
  if (status) {
    const parts = [];
    if (filterState.magMin !== -Infinity || filterState.magMax !== Infinity)
      parts.push(`Mag: ${filterState.magMin === -Infinity ? "—" : filterState.magMin}..${filterState.magMax === Infinity ? "—" : filterState.magMax} nT`);
    if (filterState.depthMin !== -Infinity || filterState.depthMax !== Infinity)
      parts.push(`Derinlik: ${filterState.depthMin === -Infinity ? "—" : filterState.depthMin}..${filterState.depthMax === Infinity ? "—" : filterState.depthMax} m`);
    parts.push(`Tür: ${[...filterState.kinds].join(", ")}`);
    status.textContent = `✅ Aktif — ${parts.join(" · ")}`;
    status.style.color = "#22c55e";
  }

  // Custom event — main.js dinleyecek
  window.dispatchEvent(new CustomEvent("votex:filter-change", { detail: { ...filterState } }));
}

function resetFilters() {
  filterState.magMin = -Infinity;
  filterState.magMax = Infinity;
  filterState.depthMin = -Infinity;
  filterState.depthMax = Infinity;
  filterState.xMin = -Infinity;
  filterState.xMax = Infinity;
  filterState.zMin = -Infinity;
  filterState.zMax = Infinity;
  filterState.kinds = new Set(["room", "tunnel", "metal", "shaft"]);
  filterState.enabled = false;

  renderFilterPanel();

  const status = document.getElementById("filter-status");
  if (status) {
    status.textContent = "Filtreler sıfırlandı";
    status.style.color = "var(--muted)";
  }

  window.dispatchEvent(new CustomEvent("votex:filter-change", { detail: { ...filterState } }));
}

/**
 * main.js'ten çağrılır — paneli initialize eder.
 */
export function bindFilterPanel() {
  renderFilterPanel();
}
