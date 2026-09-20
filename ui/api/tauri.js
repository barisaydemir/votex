import { invoke } from "@tauri-apps/api/core";

export const DESKTOP_CAPABILITIES = Object.freeze({
  filePicker: "pick_legacy_dik_json",
  legacyAnalysis: "analyze_legacy_dik_json",
  archive: "list_archive",
  fieldSessions: "set_legacy_field_sessions",
  dta: "launch_dta",
});

export function isTauriRuntime() {
  return typeof window !== "undefined" &&
    (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__?.core));
}

export function hasDesktopCapability(capability) {
  return isTauriRuntime() && Object.values(DESKTOP_CAPABILITIES).includes(String(capability));
}

function invokeDesktop(command, args) {
  const available = isTauriRuntime();
  if (!available) {
    return Promise.reject(new Error(
      "Bu işlem yalnızca VOTEX masaüstü uygulamasında kullanılabilir."
    ));
  }
  return invoke(command, args);
}

export function pickImageFile() {
  return invokeDesktop("pick_image_file");
}

export function buildSurface3d(req) {
  return invokeDesktop("build_surface_3d", { req });
}

export function getDtaLinkStatus() {
  return invokeDesktop("get_dta_link_status");
}

export function getAppSettings() {
  return invokeDesktop("get_app_settings");
}

export function setDtaLaunchPath(path) {
  return invokeDesktop("set_dta_launch_path", { path });
}

export function setAutoLaunchDta(enabled) {
  return invokeDesktop("set_auto_launch_dta", { enabled });
}

export function setSoilProfile(profile) {
  return invokeDesktop("set_soil_profile", { profile });
}

export function setSoilCorrectionEnabled(enabled) {
  return invokeDesktop("set_soil_correction_enabled", { enabled });
}

export function setStructuresThroughRed(enabled) {
  return invokeDesktop("set_structures_through_red", { enabled });
}

export function setHints3dVisible(enabled) {
  return invokeDesktop("set_hints_3d_visible", { enabled });
}

export function setLegacyDepthParams(params = {}) {
  return invokeDesktop("set_legacy_depth_params", {
    sensorHeightM: params.sensorHeightM ?? null,
    bipolarSepFactor: params.bipolarSepFactor ?? null,
    dipoleBlend: params.dipoleBlend ?? null,
  });
}

export function setLegacyDepthCalibNotes(notes = []) {
  return invokeDesktop("set_legacy_depth_calib_notes", { notes: Array.isArray(notes) ? notes : [] });
}

export function setLegacyFieldSessions(sessions = {}) {
  return invokeDesktop("set_legacy_field_sessions", { sessions: sessions && typeof sessions === "object" ? sessions : {} });
}

export function setCsvFilterPrefs(prefs) {
  return invokeDesktop("set_csv_filter_prefs", prefs);
}

export function deepStructureScan() {
  return invokeDesktop("deep_structure_scan");
}

export function stagedDepthScan() {
  return invokeDesktop("staged_depth_scan");
}

export function waterYellowScan() {
  return invokeDesktop("water_blue_scan");
}

export function waterBlueScan() {
  return invokeDesktop("water_blue_scan");
}

export function pickDtaLaunchPath() {
  return invokeDesktop("pick_dta_launch_path");
}

export function launchDta() {
  return invokeDesktop("launch_dta");
}

export function interpretVotexScreen() {
  return invokeDesktop("interpret_votex_screen");
}

export function getMapDtaHints() {
  return invokeDesktop("get_map_dta_hints");
}

export function setMapDtaHintsEnabled(enabled) {
  return invokeDesktop("set_map_dta_hints_enabled", { enabled });
}

export function getProbEngineStatus() {
  return invokeDesktop("get_prob_engine_status");
}

export function launchProbEngine() {
  return invokeDesktop("launch_prob_engine");
}

export function setProbProfile(profile) {
  return invokeDesktop("set_prob_profile", { profile });
}

export function setAutoLaunchProb(enabled) {
  return invokeDesktop("set_auto_launch_prob", { enabled });
}

export function setProbFallback(enabled) {
  return invokeDesktop("set_prob_fallback", { enabled });
}

export function getLicenseStatus() {
  return invokeDesktop("get_license_status");
}

export function activateLicense(token) {
  return invokeDesktop("activate_license", { token });
}

export function listArchive() {
  return invokeDesktop("list_archive");
}

export function loadArchive(id) {
  return invokeDesktop("load_archive", { id });
}

export function saveLegacyArchive(fileName, content, result) {
  return invokeDesktop("save_legacy_archive", { fileName, content, result });
}

export function loadLegacyArchive(id) {
  return invokeDesktop("load_legacy_archive", { id });
}

export function deleteArchive(id) {
  return invokeDesktop("delete_archive", { id });
}

export function getAppVersion() {
  return invokeDesktop("get_app_version");
}

export function getUpdateStatus() {
  return invokeDesktop("get_update_status");
}

export function pickUpdatePackage() {
  return invokeDesktop("pick_update_package");
}

export function setUpdatePackagePath(path) {
  return invokeDesktop("set_update_package_path", { path });
}

export function applySuiteUpdate(packagePath) {
  return invokeDesktop("apply_suite_update", { packagePath: packagePath ?? null });
}

export function analyzeCsvData(req) {
  return invokeDesktop("analyze_csv_data", { req });
}

export function buildSurfaceFromCsv(req) {
  return invokeDesktop("build_surface_from_csv", { req });
}

export function pickCsvFile() {
  return invokeDesktop("pick_csv_file");
}

export function parseExcelData(base64Content) {
  return invokeDesktop("parse_excel_data", { base64Content });
}

export function analyzeLegacyDikJson(content, fileName, scanStepCount = 0, scanStepSpacingM = 0, depthParams = null) {
  return invokeDesktop("analyze_legacy_dik_json", {
    content,
    fileName: fileName ?? null,
    scanStepCount: Number.isFinite(Number(scanStepCount)) ? Math.max(0, Math.floor(Number(scanStepCount))) : 0,
    scanStepSpacingM: Number.isFinite(Number(scanStepSpacingM)) && Number(scanStepSpacingM) > 0
      ? Number(scanStepSpacingM)
      : null,
    depthParams: depthParams && typeof depthParams === "object" ? depthParams : null,
  });
}

/**
 * Zero-Order Median Leveling — zig-zag heading error (Bx/By striping).
 * @param {string} content Legacy3DMag JSON string
 * @returns {Promise<{
 *   ok: boolean,
 *   message: string,
 *   columns: string[],
 *   data: number[][],
 *   stats: {
 *     referenceMedianX: number,
 *     referenceMedianY: number,
 *     segmentCount: number,
 *     segmentMedians: Array<{
 *       start: number,
 *       end: number,
 *       medianX: number,
 *       medianY: number,
 *       pointCount: number
 *     }>
 *   },
 *   leveledJson: string
 * }>}
 */
export function levelLegacyMagJson(content) {
  return invokeDesktop("level_legacy_mag_json", { content });
}

export function pickLegacyDikJson() {
  return invokeDesktop("pick_legacy_dik_json");
}

export function saveFileDialog(content, suggestedName, filterName, filterExts) {
  return invokeDesktop("save_file_dialog", { content, suggestedName, filterName, filterExts });
}

