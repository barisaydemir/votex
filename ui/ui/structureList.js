import { $, state } from "../app/state.js";
import { formatDepthM } from "../viewer/colors.js";
import { focusStructure } from "../viewer/labels.js";
import { pulseStructureCards } from "./scanFx.js";
import { t, tPhrase } from "../i18n/index.js";
import { metalCueTitle, chamberKindLabel, waterLabelOf } from "../i18n/labels.js";

/** @type {((focusId: string, kotM: number) => void) | null} */
let onKotChangeFn = null;

export function bindStructureKotApply(fn) {
  onKotChangeFn = fn;
}

export function rowHtml(label, value) {
  return `<div class="sc-row"><span>${label}</span><strong>${value}</strong></div>`;
}

function kotOf(focusId) {
  const kot = Number(state.structureKotM?.[focusId] ?? 0);
  return Number.isFinite(kot) ? kot : 0;
}

function depthWithKot(meters, focusId) {
  return Number(meters || 0) + kotOf(focusId);
}

function kotRow(focusId) {
  const kot = kotOf(focusId);
  return `
    <div class="sc-row sc-kot" data-kot-row="${focusId}">
      <span>${t("sc.kot")}</span>
      <input type="number" class="sc-kot-input" data-focus-id="${focusId}"
        value="${kot}" step="0.1" min="-10" max="30"
        title="${t("sc.kotTitle")}" />
    </div>
  `;
}

export function confPct(obj) {
  const c = Number(obj?.confidence ?? 0);
  return Math.round(c * 100);
}

export function confLabel(obj) {
  const p = confPct(obj);
  return p > 0 ? ` · %${p}` : "";
}

function geoOf(obj) {
  return obj?.geometry || {};
}

function whyRows(obj) {
  const ev = obj?.evidence || {};
  const reasons = ev.reasons || [];
  const conf = confPct(obj);
  const path = Math.round(Number(ev.pathSupport ?? ev.path_support ?? 0) * 100);
  const wall = Math.round(Number(ev.wallSupport ?? ev.wall_support ?? 0) * 100);
  const snr = Number(ev.snr ?? 0);
  const margin = Number(ev.classMargin ?? ev.class_margin ?? 0);
  const chips = [];
  if (conf > 0) chips.push(`%${conf}`);
  if (snr > 0) chips.push(`SNR ${snr.toFixed(1)}`);
  if (margin > 0) chips.push(`Δ ${margin.toFixed(2)}`);
  if (path > 0) chips.push(`path ${path}%`);
  if (wall > 0) chips.push(`${t("sc.envelope")} ${wall}%`);
  const reasonBits = reasons
    .slice(0, 6)
    .map((r) => String(r).replace(/^score:/, t("sc.class")).replace(/^rewrite:/, "→ "))
    .filter(Boolean);
  if (!chips.length && !reasonBits.length) return "";
  return `
    <div class="sc-why">
      <div class="sc-why-head">${t("sc.why", { n: conf || "—" })}</div>
      ${chips.length ? `<div class="sc-why-chips">${chips.map((c) => `<span>${c}</span>`).join("")}</div>` : ""}
      ${
        reasonBits.length
          ? `<ul class="sc-why-list">${reasonBits.map((r) => `<li>${r}</li>`).join("")}</ul>`
          : ""
      }
    </div>
  `;
}

function geoRows(obj) {
  const g = geoOf(obj);
  const ev = obj?.evidence || {};
  const wall = Math.round(Number(ev.wallSupport ?? ev.wall_support ?? 0) * 100);
  const sym = Number(g.symmetryIndex ?? g.symmetry_index ?? 0);
  if (!(sym > 0) && !g.label && !g.method && wall <= 0) return "";
  const pct = Math.round(sym * 100);
  const rect = Math.round(Number(g.rectangularity ?? 0) * 100);
  const axis = Math.round(Number(g.symmetryAxisDeg ?? g.symmetry_axis_deg ?? 0));
  const label = tPhrase(g.label || "");
  const bar = `<div class="geo-bar"><div class="geo-fill" style="width:${pct}%"></div></div>`;
  return `
    ${rowHtml(t("sc.geometry"), label || `Simetri %${pct}`.replace("Simetri", t("intel.symmetry")))}
    ${wall > 0 ? rowHtml(t("sc.wallLine"), `${wall}%`) : ""}
    <div class="sc-geo">${bar}<span>${t("sc.geoBar", { sym: pct, rect, axis })}</span></div>
  `;
}

export function renderStructureList(surface) {
  const host = $("structure-list");
  if (!host) return;
  const s = surface.structures || {};
  const chambers = s.chambers || [];
  const tunnels = s.tunnels || [];
  const metals = s.metals || [];
  const waters = s.waters || [];

  if (!chambers.length && !tunnels.length && !metals.length && !waters.length) {
    const rejected = s.rejectedCount ?? s.rejected_count ?? 0;
    host.innerHTML = `<p class="hint">${rejected ? t("list.noneRejected", { n: rejected }) : t("list.none")}</p>`;
    return;
  }

  const cards = [];
  let num = 1;

  chambers.forEach((c, i) => {
    if (c.kind === "cavity") return;
    const kind = chamberKindLabel(c.kind);
    const w = (c.widthM ?? c.width_m ?? 0).toFixed(1);
    const lenStr = (c.lengthM ?? c.length_m ?? 0).toFixed(1);
    const h = (c.heightM ?? c.height_m ?? 0).toFixed(2);
    const topRaw = Number(c.topFromSurfaceM ?? c.top_from_surface_m ?? 0);
    const botRaw = Number(c.bottomFromSurfaceM ?? c.bottom_from_surface_m ?? 0);
    const focusId = `chamber-${i}`;
    const top = formatDepthM(depthWithKot(topRaw, focusId));
    const bot = formatDepthM(depthWithKot(botRaw, focusId));
    const n = num++;
    const sizeRow =
      c.kind === "shaft"
        ? rowHtml(t("sc.diam"), `${w} m · ${h} m`)
        : rowHtml(t("sc.size"), `${w} × ${lenStr} × ${h} m`);
    const ev = c.evidence || {};
    cards.push(`
      <article class="structure-card ${c.kind || "room"}" data-focus-id="${focusId}" role="button" tabindex="0">
        <p class="sc-title"><span class="sc-num">${n}</span> ${kind}${confLabel(c)}</p>
        ${sizeRow}
        ${rowHtml(c.kind === "shaft" ? t("sc.surfaceMouth") : t("sc.surfaceRoof"), top)}
        ${rowHtml(t("sc.surfaceFloor"), bot)}
        ${kotRow(focusId)}
        ${rowHtml("SNR / margin", `${Number(ev.snr ?? 0).toFixed(1)} / ${Number(ev.classMargin ?? ev.class_margin ?? 0).toFixed(2)}`)}
        ${whyRows(c)}
        ${geoRows(c)}
      </article>
    `);
  });

  tunnels.forEach((tun, i) => {
    const dir = tun.direction || "?";
    const heading = tun.heading || "";
    const deg = Math.round(tun.bearingDeg ?? tun.bearing_deg ?? 0);
    const h = (tun.heightM ?? tun.height_m ?? 0).toFixed(2);
    const crownRaw = Number(tun.crownFromSurfaceM ?? tun.crown_from_surface_m ?? 0);
    const floorRaw = Number(tun.floorFromSurfaceM ?? tun.floor_from_surface_m ?? 0);
    const focusId = `tunnel-${i}`;
    const crown = formatDepthM(depthWithKot(crownRaw, focusId));
    const floor = formatDepthM(depthWithKot(floorRaw, focusId));
    const n = num++;
    const ev = tun.evidence || {};
    cards.push(`
      <article class="structure-card tunnel" data-focus-id="${focusId}" role="button" tabindex="0">
        <p class="sc-title"><span class="sc-num">${n}</span> ${t("sc.tunnel")} · ${dir}${confLabel(tun)}</p>
        ${rowHtml(t("sc.heading"), `${heading} (${deg}°)`)}
        ${rowHtml(t("sc.innerH"), `${h} m`)}
        ${rowHtml(t("sc.surfaceCrown"), crown)}
        ${rowHtml(t("sc.surfaceFloor"), floor)}
        ${kotRow(focusId)}
        ${rowHtml(t("sc.pathSupport"), `${Math.round((ev.pathSupport ?? ev.path_support ?? 0) * 100)}%`)}
        ${whyRows(tun)}
        ${geoRows(tun)}
      </article>
    `);
  });

  metals.forEach((m, i) => {
    const spread = (m.spreadM ?? m.spread_m ?? Math.max(m.widthM ?? m.width_m ?? 0, m.lengthM ?? m.length_m ?? 0) * 0.5).toFixed(1);
    const strength = Math.round((m.fieldStrength ?? m.field_strength ?? m.intensity ?? 0) * 100);
    const focusId = `metal-${i}`;
    const dRaw = Number(m.depthFromSurfaceM ?? m.depth_from_surface_m ?? 0);
    const d = formatDepthM(depthWithKot(dRaw, focusId));
    const inside = !!(m.insideChamber ?? m.inside_chamber);
    const geoLabel = tPhrase(m.geometry?.label || "");
    const cueTitle = metalCueTitle(m);
    const n = num++;
    const wall = Math.round((m.evidence?.wallSupport ?? m.evidence?.wall_support ?? 0) * 100);
    const bloom = Math.round((m.evidence?.pathSupport ?? m.evidence?.path_support ?? 0) * 100);
    const cx = Number(m.cx) || 0;
    const cz = Number(m.cy) || 0;
    const cy = -dRaw;
    const wM = (m.widthM ?? m.width_m ?? 0).toFixed(1);
    const lM = (m.lengthM ?? m.length_m ?? 0).toFixed(1);
    cards.push(`
      <article class="structure-card metal${inside ? " inside" : ""}" data-focus-id="${focusId}" role="button" tabindex="0">
        <p class="sc-title"><span class="sc-num">${n}</span> ${cueTitle}${confLabel(m)}</p>
        ${rowHtml("Merkez noktası", `${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)} m`)}
        ${(() => { try { const g = window.__gpsMod?.getGpsState(); if (g?.active) { const gps = window.__gpsMod.localToGps(cx, cz); if (gps) return rowHtml("📍 GPS", `${gps.lat.toFixed(6)}°N, ${gps.lon.toFixed(6)}°E`); } } catch(e) {} return ""; })()}
        ${rowHtml(t("sc.depth"), d)}
        ${rowHtml(t("sc.spread"), `${spread} m`)}
        ${wM !== "0.0" ? rowHtml("Genişlik", `${wM} m`) : ""}
        ${lM !== "0.0" && lM !== wM ? rowHtml("Uzunluk", `${lM} m`) : ""}
        ${rowHtml(t("sc.field"), `${strength}%`)}
        ${kotRow(focusId)}
        ${bloom > 0 ? rowHtml(t("sc.bloom"), `${bloom}%`) : ""}
        ${wall > 0 ? rowHtml(t("sc.wall"), `${wall}%`) : ""}
        ${whyRows(m)}
        ${geoRows(m)}
      </article>
    `);
  });

  waters.forEach((wtr, i) => {
    const focusId = `water-${i}`;
    const w = (wtr.widthM ?? wtr.width_m ?? 0).toFixed(1);
    const lenStr = (wtr.lengthM ?? wtr.length_m ?? 0).toFixed(1);
    const area = Number(wtr.areaM2 ?? wtr.area_m2 ?? 0).toFixed(1);
    const dRaw = Number(wtr.depthFromSurfaceM ?? wtr.depth_from_surface_m ?? 0);
    const d = formatDepthM(depthWithKot(dRaw, focusId));
    const label = waterLabelOf(wtr);
    const n = num++;
    cards.push(`
      <article class="structure-card water" data-focus-id="${focusId}" role="button" tabindex="0">
        <p class="sc-title"><span class="sc-num">${n}</span> ${t("sc.water")}${confLabel(wtr)}</p>
        ${rowHtml(t("sc.comment"), t("sc.waterNote", { label }))}
        ${rowHtml(t("sc.spread"), `${w} × ${lenStr} m · ~${area} m²`)}
        ${rowHtml(t("sc.depth"), d)}
        ${kotRow(focusId)}
        ${whyRows(wtr)}
      </article>
    `);
  });

  host.innerHTML = cards.join("");
  host.querySelectorAll(".structure-card[data-focus-id]").forEach((el) => {
    const go = () => focusStructure(el.dataset.focusId);
    el.addEventListener("click", (ev) => {
      if (ev.target.closest(".sc-kot-input")) return;
      go();
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.target.closest(".sc-kot-input")) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        go();
      }
    });
  });
  host.querySelectorAll(".sc-kot-input").forEach((input) => {
    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev) => ev.stopPropagation());
    input.addEventListener("change", () => {
      const id = input.dataset.focusId;
      let v = Number(input.value);
      if (!Number.isFinite(v)) v = 0;
      v = Math.min(30, Math.max(-10, v));
      input.value = String(v);
      if (!state.structureKotM) state.structureKotM = {};
      state.structureKotM[id] = v;
      onKotChangeFn?.(id, v);
    });
  });
  pulseStructureCards();
}
