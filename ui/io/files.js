import { pickImageFile } from "../api/tauri.js";
import { $, state } from "../app/state.js";
import { setStatus } from "../app/status.js";
import { clearPreviewMarks } from "../ui/previewMarks.js";
import { logLine } from "../ui/telemetry.js";
import { t } from "../i18n/index.js";

export function isAllowedImage(file) {
  const name = (file.name || "").toLowerCase();
  return (
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    file.type === "image/jpeg" ||
    file.type === "image/png"
  );
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(t("msg.fileReadFail")));
    reader.readAsDataURL(file);
  });
}

export async function setPendingFromPicked(picked) {
  if (!picked) return;
  const name = picked.fileName || picked.file_name || "image";
  const base64 = picked.imageBase64 || picked.image_base64;
  const size = picked.sizeBytes ?? picked.size_bytes ?? 0;
  if (!base64) {
    setStatus(t("msg.fileEmpty"));
    logLine(t("msg.fileEmptyLog"), "err");
    return;
  }
  state.pendingFile = { name, base64 };
  $("file-name").textContent = `${name} (${Math.round(size / 1024)} KB)`;
  $("btn-build-3d").disabled = false;
  const prev = $("preview");
  prev.src = base64;
  prev.classList.add("visible");
  clearPreviewMarks();
  logLine(t("msg.fileLoaded", { name, kb: Math.round(size / 1024) }), "ok");
  setStatus(t("msg.fileReady"));
}

export async function setPendingFile(file) {
  if (!file) return;
  if (!isAllowedImage(file)) {
    setStatus(t("msg.onlyJpg"));
    logLine(t("msg.badType"), "err");
    return;
  }
  try {
    const base64 = await fileToBase64(file);
    state.pendingFile = { name: file.name, base64 };
    $("file-name").textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
    $("btn-build-3d").disabled = false;
    const prev = $("preview");
    prev.src = base64;
    prev.classList.add("visible");
    clearPreviewMarks();
    logLine(t("msg.fileLoadedShort", { name: file.name }), "ok");
    setStatus(t("msg.fileReady"));
  } catch (e) {
    setStatus(t("msg.fileReadErr", { e }));
    logLine(t("msg.fileReadLog", { e }), "err");
  }
}

export async function openNativeFileDialog() {
  try {
    setStatus(t("msg.dialogOpen"));
    logLine(t("msg.dialogOpened"), "info");
    const picked = await pickImageFile();
    if (!picked) {
      setStatus(t("msg.dialogCancel"));
      logLine(t("msg.dialogCancelLog"), "info");
      return;
    }
    setPendingFromPicked(picked);
  } catch (e) {
    setStatus(t("msg.fileOpenFail", { e }));
    logLine(t("msg.fileOpenFail", { e }), "err");
    console.error(e);
  }
}
