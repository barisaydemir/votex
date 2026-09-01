import { $ } from "../app/state.js";
import { t } from "../i18n/index.js";
import { getPackStatus, enableDualAnalysis, setModuleEnabled } from "../hybrid/dualAnalysisPack.js";

/** Sağ panel özet metrik + dağılım barları (+ geometri). */
export function renderIntelSummary(surface) {
  const s = surface?.structures || {};
  const chambers = s.chambers || [];
  const tunnels = s.tunnels || [];
  const metals = s.metals || [];
  const waters = s.waters || [];
  const nRoom = chambers.filter((c) => c.kind === "room" || c.kind === "tomb").length;
  const nShaft = chambers.filter((c) => c.kind === "shaft").length;
  const accepted =
    s.acceptedCount ?? s.accepted_count ?? nRoom + nShaft + tunnels.length + metals.length;
  const rejected = s.rejectedCount ?? s.rejected_count ?? 0;

  setText("m-accepted", accepted);
  setText("m-rejected", rejected);
  setText("m-rooms", nRoom);
  setText("m-shafts", nShaft);
  setText("m-tunnels", tunnels.length);
  setText("m-metals", metals.length);
  setText("m-waters", waters.length);

  // Ağaç rozetlerini güncelle
  const totalCount = accepted + rejected;
  const countBadge = $("intel-count-badge");
  if (countBadge) countBadge.textContent = totalCount || "0";
  const structBadge = $("structure-count-badge");
  if (structBadge) structBadge.textContent = (nRoom + nShaft + tunnels.length + metals.length) || "0";

  const voidN = nRoom + nShaft;
  const total = Math.max(1, voidN + tunnels.length + metals.length + waters.length);
  setBar("bar-void", "bar-void-pct", (voidN / total) * 100);
  setBar("bar-tunnel", "bar-tunnel-pct", (tunnels.length / total) * 100);
  setBar("bar-metal", "bar-metal-pct", (metals.length / total) * 100);

  const gr = s.geometryReport || s.geometry_report || {};
  const meanSym = Number(gr.meanSymmetry ?? gr.mean_symmetry ?? 0);
  const hi = Number(gr.highSymmetryCount ?? gr.high_symmetry_count ?? 0);
  setText("m-sym", meanSym > 0 ? `${Math.round(meanSym * 100)}%` : "—");
  setText("m-sym-hi", hi);
  setBar("bar-sym", "bar-sym-pct", meanSym * 100);

  const eng = $("intel-engine");
  if (eng) {
    const label = gr.probEngineLabel || gr.prob_engine_label || "";
    const legacy = gr.probUsedLegacy ?? gr.prob_used_legacy;
    if (legacy === false) {
      eng.textContent = t("intel.engineVpe", { label: label ? ` · ${label}` : "" });
    } else if (label) {
      eng.textContent = t("intel.engineLegacy", { label });
    } else {
      eng.textContent = t("intel.engine");
    }
  }

  const soilEl = $("intel-soil");
  if (soilEl) {
    const applied = surface?.soilCorrectionApplied ?? surface?.soil_correction_applied;
    const id = (surface?.soilProfile || surface?.soil_profile || "").toLowerCase();
    const label = surface?.soilLabel || surface?.soil_label || "";
    const scale = Number(surface?.soilDepthScale ?? surface?.soil_depth_scale ?? 1);
    if (applied === false || id === "off" || !id) {
      soilEl.textContent = t("intel.soilOff");
    } else {
      const short = (label || id).split("·")[0].trim();
      soilEl.textContent = t("intel.soilOn", { short, scale: scale.toFixed(2) });
    }
  }

  // ── Çift Analiz Durumu ──
  const dualStatus = getPackStatus();
  const dualEl = $("intel-dual-status");
  if (dualEl) {
    if (dualStatus.enabled) {
      const activeMods = Object.entries(dualStatus.modules)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .length;
      dualEl.textContent = `Çift Analiz: ${activeMods}/5 aktif`;
      dualEl.style.color = "#10b981";
    } else {
      dualEl.textContent = "Çift Analiz: pasif";
      dualEl.style.color = "#888";
    }
  }
}

export function resetIntelSummary() {
  ["m-accepted", "m-rejected", "m-rooms", "m-shafts", "m-tunnels", "m-metals", "m-waters", "m-sym-hi"].forEach(
    (id) => setText(id, 0)
  );
  setText("m-sym", "—");
  setBar("bar-void", "bar-void-pct", 0);
  setBar("bar-tunnel", "bar-tunnel-pct", 0);
  setBar("bar-metal", "bar-metal-pct", 0);
  setBar("bar-sym", "bar-sym-pct", 0);
  const soilEl = $("intel-soil");
  if (soilEl) soilEl.textContent = t("intel.soil");
}

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = String(v);
}

function setBar(fillId, pctId, pct) {
  const p = Math.round(Math.min(100, Math.max(0, pct)));
  const fill = $(fillId);
  const label = $(pctId);
  if (fill) fill.style.width = `${p}%`;
  if (label) label.textContent = `${p}%`;
}
