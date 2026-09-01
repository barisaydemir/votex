import {

  getAppSettings,

  setSoilCorrectionEnabled,

  setSoilProfile,

} from "../api/tauri.js";

import { $ } from "../app/state.js";

import { setStatus } from "../app/status.js";

import { logLine } from "./telemetry.js";



import { t } from "../i18n/index.js";

const SOIL_IDS = ["off", "sand", "loam", "wet_clay", "laterite", "organic"];



const SOIL_SCALES = {

  off: 1.0,

  sand: 1.1,

  loam: 1.0,

  wet_clay: 0.85,

  laterite: 0.7,

  organic: 0.95,

};



export function selectedSoilProfile() {

  const el = document.querySelector('input[name="soil-profile"]:checked');

  const v = (el?.value || "loam").toLowerCase();

  return SOIL_IDS.includes(v) ? v : "off";

}



export function soilCorrectionEnabled() {

  const el = $("soil-correction-enabled");

  return el ? !!el.checked : true;

}



export function soilProfileLabel(id = selectedSoilProfile()) {

  return t(`soil.names.${id}`) || t("soil.names.off");

}



/** INTEL / stats satırı için kısa metin */

export function formatSoilLine(surface) {

  const applied = surface?.soilCorrectionApplied ?? surface?.soil_correction_applied;

  const id = (surface?.soilProfile || surface?.soil_profile || "").toLowerCase();

  const label = surface?.soilLabel || surface?.soil_label || soilProfileLabel(id) || id;

  const scale = Number(surface?.soilDepthScale ?? surface?.soil_depth_scale ?? SOIL_SCALES[id] ?? 1);

  if (applied === false || id === "off" || !id) {

    return t("soil.lineOff");

  }

  const short = String(label).split("·")[0].trim().split("/")[0].trim();

  return t("soil.lineOn", { short, scale: scale.toFixed(2) });

}



export function applySoilUi(profile, correctionEnabled) {

  const id = (profile || "loam").toLowerCase();

  const radio = document.querySelector(`input[name="soil-profile"][value="${id}"]`);

  if (radio) {

    radio.checked = true;

  } else {

    const off = document.querySelector('input[name="soil-profile"][value="off"]');

    if (off) off.checked = true;

  }

  const cb = $("soil-correction-enabled");

  if (cb && correctionEnabled != null) {

    cb.checked = !!correctionEnabled;

  }

  updateSoilHint();

}



export function updateSoilHint() {

  const hint = $("soil-hint");

  if (!hint) return;

  if (!soilCorrectionEnabled()) {

    hint.textContent = t("soil.correctionOff");

    return;

  }

  const id = selectedSoilProfile();

  if (id === "off") {

    hint.textContent = t("soil.offKeep");

    return;

  }

  hint.textContent = t("soil.scaled", { label: soilProfileLabel(id), scale: SOIL_SCALES[id].toFixed(2) });

}



function fillSoilSettings(s) {

  const profile = s?.soilProfile || s?.soil_profile || "loam";

  const enabled = s?.soilCorrectionEnabled ?? s?.soil_correction_enabled;

  applySoilUi(profile, enabled !== false);

}



export async function loadSoilSettingsUi() {

  try {

    const s = await getAppSettings();

    fillSoilSettings(s);

  } catch (e) {

    console.warn("soil settings:", e);

  }

}



/** Arşivden profil + düzeltme bayrağını geri yükle */

export function restoreSoilFromArchive(meta, surface) {

  const profile =

    meta?.soilProfile ||

    meta?.soil_profile ||

    surface?.soilProfile ||

    surface?.soil_profile ||

    "off";

  const applied =

    meta?.soilCorrectionApplied ??

    meta?.soil_correction_applied ??

    surface?.soilCorrectionApplied ??

    surface?.soil_correction_applied;

  let enabled = true;

  if (applied === false && String(profile).toLowerCase() !== "off") {

    enabled = false;

  } else if (applied === false && String(profile).toLowerCase() === "off") {

    enabled = soilCorrectionEnabled();

  } else if (applied === true) {

    enabled = true;

  }

  applySoilUi(profile, enabled);

  setSoilProfile(String(profile)).catch(() => {});

  setSoilCorrectionEnabled(enabled).catch(() => {});

}



export function bindSoilControls() {

  const onProfile = async (profile) => {

    try {

      await setSoilProfile(profile);

      updateSoilHint();

      logLine(`Toprak: ${soilProfileLabel(profile)}`, profile === "off" ? "warn" : "ok");

      setStatus(

        profile === "off"

          ? "Toprak: Kapalı (eski hesap)"

          : `Toprak: ${soilProfileLabel(profile)}`

      );

    } catch (e) {

      logLine(`Toprak: ${e}`, "err");

    }

  };



  document.querySelectorAll('input[name="soil-profile"]').forEach((el) => {

    el.addEventListener("change", (e) => {

      if (e.target.checked) onProfile(e.target.value);

    });

  });



  $("soil-correction-enabled")?.addEventListener("change", async (e) => {

    const enabled = !!e.target.checked;

    try {

      await setSoilCorrectionEnabled(enabled);

      updateSoilHint();

      logLine(

        enabled

          ? "Toprak düzeltmesi açık"

          : "Toprak düzeltmesi kapalı — legacy derinlik",

        enabled ? "ok" : "warn"

      );

      setStatus(enabled ? "Toprak düzeltmesi: açık" : "Toprak düzeltmesi: kapalı (legacy)");

    } catch (err) {

      e.target.checked = !enabled;

      logLine(`Toprak ayar: ${err}`, "err");

    }

  });

}



export function startSoilMonitor() {

  loadSoilSettingsUi();

  bindSoilControls();

}


