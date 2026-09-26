/**
 * 📱 Cihaza Bağlan — BLE canlı veri akışını Legacy analiz hattına bağlar.
 *
 * Katman ayrımı: Rust (bt_link.rs) yalnızca ham baytları `bt-data` olayıyla
 * iletir; mesaj birleştirme `../device/btStream.js` saf modülünde, UI yönetimi
 * burada, analiz ise `legacyDikPanel.analyzeLegacyContent` girişindedir.
 */

import { attachFieldReport, btScan, btConnect, btDisconnect, isTauriRuntime } from "../api/tauri.js";
import {
  buildLegacyJsonFromMessages,
  computeScanCoverage,
  createBtJsonAssembler,
  createLiveHeatAccumulator,
  heatPointsToTrail,
} from "../device/btStream.js";
import { computeBounds } from "../viewer/csvFilter.js";
import { analyzeLegacyContent } from "./legacyDikPanel.js";
import { renderCsvHeatmap } from "../viewer/csvOverlay.js";
import { $, state } from "../app/state.js";
import { buildLegacyFieldReportHtml } from "../viewer/legacyFieldReport.js";
import { verificationStatusOf } from "../viewer/legacyUnifiedObjectMap.js";
import { showLegacyFieldReport } from "./fieldReportView.js";
import { captureSceneImage } from "./reportExport.js";
import { frameTargetsForCapture } from "../viewer/viewEnhancements.js";
import { logLine } from "./telemetry.js";

let _bound = false;
let _assembler = null;
let _unlistenData = null;
let _unlistenLink = null;
let _fileNameSeq = 0;
let _heatAcc = null;
let _heatTimer = null;
let _heatLastRender = 0;
let _lastSavedMessageCount = 0;

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

function assembler() {
  if (!_assembler) _assembler = createBtJsonAssembler();
  return _assembler;
}

/** Harita görünümü: "device" (cihaz ekranı görünümü) veya "votex". */
function heatStyle() {
  return $("bt-heat-style")?.value === "votex" ? "votex" : "device";
}

function readFieldOptions() {
  const xMeters = Number($("bt-field-width")?.value);
  const yMeters = Number($("bt-field-length")?.value);
  return { xMeters, yMeters };
}

function scanFileName() {
  _fileNameSeq += 1;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `bt-canli-${stamp}-${_fileNameSeq}.json`;
}

/** Canlı sayaç: mesaj · nokta · hedef kare · bayt. */
function updateStreamStatus() {
  const stats = assembler().stats();
  const el = $("bt-stream-status");
  if (el) {
    const rows = Number($("legacy-dik-matrix-rows")?.value) || 0;
    const cols = Number($("legacy-dik-matrix-cols")?.value) || 0;
    const target = rows > 0 && cols > 0 ? rows * cols : 0;
    const kb = (stats.byteCount / 1024).toFixed(1);
    const targetText = target > 0 ? ` · hedef ${stats.pointCount}/${target} kare` : "";
    const droppedText = stats.droppedCount > 0 ? ` · ${stats.droppedCount} bozuk` : "";
    const coverage = currentCoverage();
    const missedText =
      coverage && coverage.unvisitedCount > 0 ? ` · ⚠ ${coverage.unvisitedCount} kare atlandı` : "";
    el.textContent = `${stats.messageCount} mesaj · ${stats.pointCount} nokta${targetText}${droppedText}${missedText} · ${kb} KB`;
  }
  const analyzeBtn = $("btn-bt-analyze");
  if (analyzeBtn) analyzeBtn.disabled = stats.pointCount === 0;
  const finishBtn = $("btn-bt-finish");
  if (finishBtn) finishBtn.disabled = stats.pointCount === 0;
  const resetBtn = $("btn-bt-reset");
  if (resetBtn) resetBtn.disabled = stats.messageCount === 0;
}

// ── Canlı ısı haritası — tarama sürerken 2D haritayı besler ──
const LIVE_HEAT_MIN_MS = 300;

function heatAccumulator() {
  if (!_heatAcc) _heatAcc = createLiveHeatAccumulator();
  return _heatAcc;
}

function renderLiveHeat() {
  _heatLastRender = Date.now();
  const points = heatAccumulator().update(assembler().values());
  if (!points.length) return;
  const coverage = currentCoverage();
  const style = heatStyle();
  try {
    // undergroundOnly: false — yüzey manyetik taraması; z bilinçli olarak y ile
    // eşlenir (heatmap dikey eksen etiketleri z aralığından okunur).
    // bounds: matris alanı — atlanan kenar kareler ancak tam alan çizilirse görünür.
    // palette/thresholdContour: cihazın kendi programının görünümü (gökkuşağı +
    // eşik üstü kontur); "votex" seçilirse simetrik yeşil zeminli görünüm.
    renderCsvHeatmap(
      { points, pointCount: points.length },
      {
        undergroundOnly: false,
        palette: style,
        thresholdContour: style === "device",
        ...(coverage ? { bounds: coverage.fieldPx } : {}),
      }
    );
  } catch (e) {
    console.warn("[bt] canlı harita:", e);
  }
  drawScanGuideLayer(points, coverage);
}

/** Matris kapsaması — panel matris/alan girdilerine göre atlanan kareleri hesaplar. */
function currentCoverage() {
  const points = heatAccumulator().update(assembler().values());
  if (!points.length) return null;
  const rows = Number($("legacy-dik-matrix-rows")?.value) || 0;
  const cols = Number($("legacy-dik-matrix-cols")?.value) || 0;
  const { xMeters, yMeters } = readFieldOptions();
  return computeScanCoverage(points, { rows, cols, xMeters, yMeters });
}

/**
 * Yürüyüş izi + ziyaret edilmemiş kare katmanı — heatmap'in üzerine çizilir.
 * Atlanan kareler kırmızı kesikli çerçeve, iz mavi çizgi; başlangıç yeşil,
 * güncel konum beyaz halka. Uydurma ölçüm üretilmez.
 */
function drawScanGuideLayer(points, coverage) {
  const canvas =
    document.getElementById("split-heatmap-canvas") || document.getElementById("csv-heatmap-canvas");
  const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  if (!ctx || !points?.length) return;
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return;

  const b = coverage ? coverage.fieldPx : computeBounds(points);
  const sx = b.xMax - b.xMin || 1;
  const sy = b.yMax - b.yMin || 1;
  const mapX = (x) => ((x - b.xMin) / sx) * w;
  const mapY = (y) => ((y - b.yMin) / sy) * h;

  if (coverage) {
    const cellW = w / coverage.cols;
    const cellH = h / coverage.rows;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(226, 58, 58, 0.65)";
    ctx.fillStyle = "rgba(226, 58, 58, 0.10)";
    for (const cell of coverage.unvisited) {
      const x = cell.col * cellW;
      const y = cell.row * cellH;
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, cellW - 1), Math.max(0, cellH - 1));
    }
    ctx.restore();
  }

  const trail = heatPointsToTrail(points, 2);
  if (trail.length > 1) {
    ctx.save();
    ctx.strokeStyle = "rgba(126, 225, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const x = mapX(p.x);
      const y = mapY(p.y);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "rgba(126, 225, 255, 0.55)";
    for (const p of trail) ctx.fillRect(mapX(p.x) - 1.5, mapY(p.y) - 1.5, 3, 3);
    ctx.restore();
  }

  const first = trail[0];
  const lastPoint = trail[trail.length - 1];
  if (first) {
    ctx.fillStyle = "rgba(62, 220, 140, 0.9)";
    ctx.fillRect(mapX(first.x) - 2.5, mapY(first.y) - 2.5, 5, 5);
  }
  if (lastPoint) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mapX(lastPoint.x), mapY(lastPoint.y), 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function scheduleLiveHeat() {
  if (_heatTimer) return;
  const wait = Math.max(0, LIVE_HEAT_MIN_MS - (Date.now() - _heatLastRender));
  _heatTimer = setTimeout(() => {
    _heatTimer = null;
    renderLiveHeat();
  }, wait);
}

function clearLiveHeat() {
  for (const id of ["split-heatmap-canvas", "csv-heatmap-canvas"]) {
    const canvas = document.getElementById(id);
    const ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

async function startListeners() {
  if (!isTauriRuntime()) return;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    if (_unlistenData) { _unlistenData(); _unlistenData = null; }
    if (_unlistenLink) { _unlistenLink(); _unlistenLink = null; }
    _unlistenData = await listen("bt-data", (event) => {
      const payload = event?.payload || {};
      if (payload.b64) assembler().pushBase64(payload.b64);
      updateStreamStatus();
      scheduleLiveHeat();
    });
    _unlistenLink = await listen("bt-link", (event) => {
      if (event?.payload?.connected === false) {
        stopListeners();
        setLinkUi({ connected: false });
        void maybeAutoArchive("Cihaz bağlantısı koptu");
      }
    });
  } catch (e) {
    console.warn("[bt] olay dinleyicisi kurulamadı:", e);
  }
}

function stopListeners() {
  if (_unlistenData) { try { _unlistenData(); } catch (_) {} _unlistenData = null; }
  if (_unlistenLink) { try { _unlistenLink(); } catch (_) {} _unlistenLink = null; }
}

function setLinkUi(st) {
  const connected = !!st?.connected;
  const linkEl = $("bt-link-status");
  if (linkEl) {
    linkEl.textContent = connected
      ? `Bağlı: ${st.deviceName || st.deviceId || "cihaz"}${st.messageCount ? ` · ${st.messageCount} paket` : ""}`
      : "Bağlı değil";
    linkEl.classList.toggle("is-connected", connected);
  }
  const scanBtn = $("btn-bt-scan");
  const connectBtn = $("btn-bt-connect");
  const disconnectBtn = $("btn-bt-disconnect");
  const listEl = $("bt-device-list");
  if (scanBtn) scanBtn.disabled = connected;
  if (listEl && connected) listEl.disabled = true;
  if (connectBtn) connectBtn.disabled = connected || !listEl?.value;
  if (disconnectBtn) disconnectBtn.disabled = !connected;
  updateStreamStatus();
}

async function handleScan() {
  try {
    setStatus("Bluetooth cihazları aranıyor (~4 sn)…");
    const list = await btScan(4000);
    const listEl = $("bt-device-list");
    if (listEl) {
      listEl.innerHTML = "";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = list.length ? "— cihaz seçin —" : "— cihaz bulunamadı —";
      listEl.appendChild(empty);
      for (const dev of list) {
        const opt = document.createElement("option");
        opt.value = dev.id;
        const rssi = dev.rssi != null ? ` · ${dev.rssi} dBm` : "";
        opt.textContent = `${dev.name || "(isimsiz cihaz)"}${rssi}`;
        listEl.appendChild(opt);
      }
      listEl.disabled = list.length === 0;
      const connectBtn = $("btn-bt-connect");
      if (connectBtn) connectBtn.disabled = list.length === 0;
    }
    setStatus(`${list.length} Bluetooth cihazı bulundu`);
    logLine(`[BT] tarama: ${list.length} cihaz`);
  } catch (e) {
    console.warn("[bt] tarama:", e);
    setStatus(`Bluetooth taraması: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleConnect() {
  const deviceId = $("bt-device-list")?.value;
  if (!deviceId) {
    setStatus("Önce listeden bir cihaz seçin");
    return;
  }
  try {
    setStatus("Cihaza bağlanılıyor…");
    assembler().reset();
    heatAccumulator().reset();
    clearLiveHeat();
    _lastSavedMessageCount = 0;
    const st = await btConnect(deviceId);
    await startListeners();
    setLinkUi(st);
    const channels = st.subscribed?.length ? ` · ${st.subscribed.length} bildirim kanalı` : "";
    setStatus(`Bağlandı — ${st.deviceName || deviceId}${channels}`);
    logLine(`[BT] bağlanıldı: ${st.deviceName || deviceId}`);
  } catch (e) {
    console.warn("[bt] bağlantı:", e);
    setStatus(`Cihaz bağlantısı: ${e instanceof Error ? e.message : String(e)}`);
    setLinkUi({ connected: false });
  }
}

async function handleDisconnect() {
  try {
    await btDisconnect();
  } catch (e) {
    console.warn("[bt] kopma:", e);
  }
  stopListeners();
  setLinkUi({ connected: false });
  await maybeAutoArchive("Bağlantı kesildi");
}

/**
 * Tarama/kopma bittiğinde kaydedilmemiş akışı otomatik arşivler.
 * `analyzeLegacyContent` Case Package + Legacy arşiv kaydını zaten yapar;
 * buradaki iş yalnızca "Kaydet telaşı"nı ortadan kaldırmaktır.
 */
async function maybeAutoArchive(reason) {
  const stats = assembler().stats();
  if (stats.pointCount === 0) {
    setStatus(`${reason} — henüz toplanan veri yok`);
    return;
  }
  if (stats.messageCount <= _lastSavedMessageCount) {
    setStatus(`${reason} — toplanan veri zaten arşivlendi`);
    return;
  }
  setStatus(`${reason} — ${stats.pointCount} nokta otomatik Case Package olarak arşivleniyor…`);
  await handleAnalyze();
}

/** Tek dokunuş: taramayı bitir, akışı derle ve Case Package + arşiv kaydını yap. */
async function handleFinish() {
  try {
    await btDisconnect();
  } catch (_) {}
  stopListeners();
  setLinkUi({ connected: false });
  assembler().flush();
  updateStreamStatus();
  await maybeAutoArchive("Tarama bitti");
  showFieldReport();
}

/**
 * Bitir ve Kaydet sonrası tek sayfalık saha raporu — kapsama yüzdesi,
 * atlanan kareler ve hedef listesi operatör kararlarıyla birlikte.
 */
function showFieldReport() {
  const fieldModel = state.legacyFieldModel;
  if (!fieldModel) return;
  const coverage = currentCoverage();
  const rows = Number($("legacy-dik-matrix-rows")?.value) || 0;
  const cols = Number($("legacy-dik-matrix-cols")?.value) || 0;
  const { xMeters, yMeters } = readFieldOptions();
  const stats = assembler().stats();
  const targets = (Array.isArray(fieldModel.mergedTargets) ? fieldModel.mergedTargets : []).map(
    (t) => ({
      targetId: t.targetId,
      detectionIds: t.detectionIds,
      depthTopM: t.depthTopM,
      depthBottomM: t.depthBottomM,
      confidence: t.confidence,
      status: verificationStatusOf(t, state),
    })
  );
  // Seçili hedefleri tek karede çerçeveler, sahne görüntüsünü alır ve kamerayı
  // eski konumuna döndürür — kalıcı görünüm etkilenmez.
  const frameIds = state.legacyReportTargetIds?.length
    ? [...state.legacyReportTargetIds]
    : targets.flatMap((t) => (Array.isArray(t.detectionIds) ? t.detectionIds.map(String) : []));
  const restoreCamera = frameTargetsForCapture(frameIds);
  const sceneImage = captureSceneImage("image/png");
  restoreCamera();
  // Yürüyüş izi — haritadaki izle aynı kaynaktan; kontrol listesi ve
  // kapsama diyagramı bu izi kullanır.
  const trail = heatPointsToTrail(heatAccumulator().update(assembler().values()), 2);
  const sceneCaption = state.legacyReportTargetIds?.length
    ? `Seçilen hedefler: ${state.legacyReportTargetIds.join(", ")}`
    : targets.length
      ? `Rapor hedefleri (${targets.length}) tek karede çerçevelendi`
      : "";

  const html = buildLegacyFieldReportHtml({
      generatedAt: new Date().toISOString(),
      sensitivityPercent: state.sensitivityPercent,
      source: {
        fileName: state.legacyDikFileName || "bt-canli.json",
        fingerprint:
          state.legacyCasePackage?.source?.fingerprint || state.legacyDikResult?.fingerprint || "",
      },
      scan: {
        matrixRows: rows,
        matrixCols: cols,
        fieldWidthM: xMeters,
        fieldLengthM: yMeters,
        pointCount: stats.pointCount,
        messageCount: stats.messageCount,
        droppedCount: stats.droppedCount,
      },
      coverage,
      targets,
      sceneImage,
      sceneCaption,
      trail,
  });
  showLegacyFieldReport(html);
  void attachReportToArchive(html);
}

/** Rapor HTML'ini son arşiv kaydına iliştirir (field_report.html + hash metadata). */
async function attachReportToArchive(html) {
  const id = state.legacyArchiveEntryId;
  if (!id) return;
  try {
    await attachFieldReport(id, html);
    logLine(`[rapor] saha raporu arşive eklendi · ${id}`);
  } catch (e) {
    console.warn("[rapor] arşive eklenemedi:", e);
  }
}

/** Toplanan akışı tek Legacy belgesine derler ve mevcut analiz hattından geçirir. */
async function handleAnalyze() {
  const built = buildLegacyJsonFromMessages(assembler().values(), readFieldOptions());
  if (!built.ok) {
    setStatus(`Analiz: ${built.message}`);
    return;
  }
  setStatus(`${built.pointCount} nokta analiz hattına gönderiliyor…`);
  await analyzeLegacyContent(built.content, scanFileName());
  _lastSavedMessageCount = assembler().stats().messageCount;
}

export function bindDeviceLink() {
  if (_bound) return;
  const box = $("bt-device-box");
  if (!box) return;
  _bound = true;
  $("btn-bt-scan")?.addEventListener("click", () => void handleScan());
  $("btn-bt-connect")?.addEventListener("click", () => void handleConnect());
  $("btn-bt-disconnect")?.addEventListener("click", () => void handleDisconnect());
  $("btn-bt-analyze")?.addEventListener("click", () => void handleAnalyze());
  $("btn-bt-finish")?.addEventListener("click", () => void handleFinish());
  $("btn-bt-reset")?.addEventListener("click", () => {
    assembler().reset();
    heatAccumulator().reset();
    clearLiveHeat();
    _lastSavedMessageCount = 0;
    updateStreamStatus();
    setStatus("Canlı akış sıfırlandı");
  });
  $("bt-device-list")?.addEventListener("change", () => setLinkUi({ connected: false }));
  $("bt-heat-style")?.addEventListener("change", () => renderLiveHeat());
  updateStreamStatus();
}
