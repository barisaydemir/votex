import { invoke } from "@tauri-apps/api/core";

export function pickImageFile() {
  return invoke("pick_image_file");
}

export function buildSurface3d(req) {
  return invoke("build_surface_3d", { req });
}

export function getDtaLinkStatus() {
  return invoke("get_dta_link_status");
}

export function getAppSettings() {
  return invoke("get_app_settings");
}

export function setDtaLaunchPath(path) {
  return invoke("set_dta_launch_path", { path });
}

export function setAutoLaunchDta(enabled) {
  return invoke("set_auto_launch_dta", { enabled });
}

export function setSoilProfile(profile) {
  return invoke("set_soil_profile", { profile });
}

export function setSoilCorrectionEnabled(enabled) {
  return invoke("set_soil_correction_enabled", { enabled });
}

export function setStructuresThroughRed(enabled) {
  return invoke("set_structures_through_red", { enabled });
}

export function setHints3dVisible(enabled) {
  return invoke("set_hints_3d_visible", { enabled });
}

export function setCsvFilterPrefs(prefs) {
  return invoke("set_csv_filter_prefs", prefs);
}

export function deepStructureScan() {
  return invoke("deep_structure_scan");
}

export function stagedDepthScan() {
  return invoke("staged_depth_scan");
}

export function waterYellowScan() {
  return invoke("water_blue_scan");
}

export function waterBlueScan() {
  return invoke("water_blue_scan");
}

export function pickDtaLaunchPath() {
  return invoke("pick_dta_launch_path");
}

export function launchDta() {
  return invoke("launch_dta");
}

export function interpretVotexScreen() {
  return invoke("interpret_votex_screen");
}

export function getMapDtaHints() {
  return invoke("get_map_dta_hints");
}

export function setMapDtaHintsEnabled(enabled) {
  return invoke("set_map_dta_hints_enabled", { enabled });
}

export function getProbEngineStatus() {
  return invoke("get_prob_engine_status");
}

export function launchProbEngine() {
  return invoke("launch_prob_engine");
}

export function setProbProfile(profile) {
  return invoke("set_prob_profile", { profile });
}

export function setAutoLaunchProb(enabled) {
  return invoke("set_auto_launch_prob", { enabled });
}

export function setProbFallback(enabled) {
  return invoke("set_prob_fallback", { enabled });
}

export function getLicenseStatus() {
  return invoke("get_license_status");
}

export function activateLicense(token) {
  return invoke("activate_license", { token });
}

export function listArchive() {
  return invoke("list_archive");
}

export function loadArchive(id) {
  return invoke("load_archive", { id });
}

export function deleteArchive(id) {
  return invoke("delete_archive", { id });
}

export function getAppVersion() {
  return invoke("get_app_version");
}

export function getUpdateStatus() {
  return invoke("get_update_status");
}

export function pickUpdatePackage() {
  return invoke("pick_update_package");
}

export function setUpdatePackagePath(path) {
  return invoke("set_update_package_path", { path });
}

export function applySuiteUpdate(packagePath) {
  return invoke("apply_suite_update", { packagePath: packagePath ?? null });
}

export function analyzeCsvData(req) {
  return invoke("analyze_csv_data", { req });
}

export function buildSurfaceFromCsv(req) {
  return invoke("build_surface_from_csv", { req });
}

export function pickCsvFile() {
  return invoke("pick_csv_file");
}

export function parseExcelData(base64Content) {
  return invoke("parse_excel_data", { base64Content });
}

export function saveFileDialog(content, suggestedName, filterName, filterExts) {
  return invoke("save_file_dialog", { content, suggestedName, filterName, filterExts });
}

