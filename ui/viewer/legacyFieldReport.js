/**
 * Tek sayfalık otomatik saha raporu — "Bitir ve Kaydet" sonrası üretilir.
 *
 * Saf modül: DOM/Tauri bağımlılığı yoktur; yalnız veri alır, yazdırılabilir
 * tek sayfa HTML döndürür. Kapsama yüzdesi, atlanan kareler ve hedef listesi
 * operatör doğrulama durumlarıyla birlikte sunulur. Uydurma ölçüm/hedef
 * üretilmez — veri olmayan alanlar açıkça "—" veya notla raporlanır.
 */
import { calculateSensitivityParameters } from "../hybrid/sensitivity.js";

/**
 * Hassasiyet altbilgi satırı — analizin yeniden üretilebilmesi için gerekli
 * eşikleri tek satırda özetler. Hassasiyet verilmezse boş döner.
 * @param {number} sensitivityPercent — %0-100
 * @returns {string}
 */
function sensitivityFooterLine(sensitivityPercent) {
  if (sensitivityPercent == null) return "";
  const raw = Number(sensitivityPercent);
  if (!Number.isFinite(raw)) return "";
  const p = calculateSensitivityParameters(raw);
  const label = String(p.label || "").replace(/^[^a-zA-ZÇĞİÖŞÜçğıöşü]+/, "").trim();
  return (
    `%${p.percent} (${label}) · min güven ${p.minConfidence.toFixed(2)}` +
    ` · eşik ${p.matchThreshold.toFixed(3)} · min alan ${p.minArea} px`
  );
}

import { HEAT_PX_PER_M } from "../device/btStream.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** Doğrulama durumu → rapor etiketi (3D rozetle aynı değerler). */
export const REPORT_STATUS_LABELS = Object.freeze({
  confirmed: "Doğrulandı",
  rejected: "Reddedildi",
  reviewed: "İncelendi",
  unverified: "Doğrulanmadı",
});

// Beyaz baskı zemininde okunan karşılıkları (3D rozet renklerinin koyu varyantı).
const STATUS_ACCENTS = Object.freeze({
  confirmed: "#1f8a55",
  rejected: "#c22c2c",
  reviewed: "#b57708",
  unverified: "#6b7684",
});

/** Kontrol listesi nihai hükmü. */
export const CHECKLIST_VERDICTS = Object.freeze({
  tam: "TARAMA TAM",
  dikkat: "KONTROL GEREKLİ",
  eksik: "TARAMA EKSİK",
});

const pctText = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? `%${Math.round(Math.max(0, Math.min(1, n)) * 100)}` : "—";
};

const fmtDepth = (top, bottom) => {
  const t = Number(top);
  const b = Number(bottom ?? top);
  if (!Number.isFinite(t)) return "—";
  if (Number.isFinite(b) && Math.abs(b - t) > 1e-9) return `${t.toFixed(2)}–${b.toFixed(2)} m`;
  return `${t.toFixed(2)} m`;
};

/** Dosya adı önerisi — raporun HTML kaydı için. */
export function legacyFieldReportFileName(now = new Date()) {
  const pad = (v) => String(v).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `votex-saha-raporu-${stamp}.html`;
}

/** Atlanan kare listesi — "Satır N · Sütun M" biçiminde (1 tabanlı). */
function missedCellsList(unvisited, limit = 24) {
  const list = Array.isArray(unvisited) ? unvisited : [];
  return (
    list
      .slice(0, limit)
      .map((c) => `Satır ${c.row + 1} · Sütun ${c.col + 1}`)
      .join(", ") + (list.length > limit ? ` … (+${list.length - limit})` : "")
  );
}

/**
 * Kapsama + yürüyüş izi diyagramı (SVG) — haritadaki görselle aynı dil:
 * ölçülen kare yeşil, atlanan kare kırmızı ×, yürüyüş izi mavi çizgi,
 * başlangıç yeşil kare, güncel konum halka.
 *
 * @param {object|null} coverage computeScanCoverage çıktısı
 * @param {Array<{x:number,y:number}>} trail heatmap ölçekli yürüyüş izi
 * @returns {string} SVG — kapsama yoksa boş
 */
export function buildCoverageTrailSvg(coverage, trail, opts = {}) {
  if (!coverage) return "";
  const width = Math.max(120, Number(opts.width) || 340);
  const cols = Math.max(1, coverage.cols);
  const rows = Math.max(1, coverage.rows);
  const height = Math.max(80, Math.round((width * rows) / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  const b = coverage.fieldPx;
  const sx = b.xMax - b.xMin || 1;
  const sy = b.yMax - b.yMin || 1;
  const mapX = (x) => ((x - b.xMin) / sx) * width;
  const mapY = (y) => ((y - b.yMin) / sy) * height;

  let cells = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const count = coverage.cellCounts[r * cols + c] || 0;
      const x = c * cellW;
      const y = r * cellH;
      cells +=
        `<rect class="cell" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellW.toFixed(1)}" height="${cellH.toFixed(1)}" ` +
        `fill="${count > 0 ? "#d3ecdd" : "#f7d4d4"}" stroke="#8fa3ba" stroke-width="1"/>`;
      if (count === 0) {
        const cx = x + cellW / 2;
        const cy = y + cellH / 2;
        const k = Math.min(cellW, cellH) * 0.22;
        cells +=
          `<path class="miss" d="M ${(cx - k).toFixed(1)} ${(cy - k).toFixed(1)} L ${(cx + k).toFixed(1)} ${(cy + k).toFixed(1)} ` +
          `M ${(cx + k).toFixed(1)} ${(cy - k).toFixed(1)} L ${(cx - k).toFixed(1)} ${(cy + k).toFixed(1)}" ` +
          `stroke="#c22c2c" stroke-width="1.5"/>`;
      }
    }
  }

  const pts = Array.isArray(trail) ? trail : [];
  let trailSvg = "";
  if (pts.length > 1) {
    const pointsAttr = pts.map((p) => `${mapX(p.x).toFixed(1)},${mapY(p.y).toFixed(1)}`).join(" ");
    trailSvg += `<polyline points="${pointsAttr}" fill="none" stroke="#2b7fd4" stroke-width="1.5" stroke-opacity="0.85"/>`;
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first) {
    trailSvg += `<rect x="${(mapX(first.x) - 2.5).toFixed(1)}" y="${(mapY(first.y) - 2.5).toFixed(1)}" width="5" height="5" fill="#1f8a55"/>`;
  }
  if (last && pts.length > 1) {
    trailSvg += `<circle cx="${mapX(last.x).toFixed(1)}" cy="${mapY(last.y).toFixed(1)}" r="4" fill="none" stroke="#14202e" stroke-width="1.5"/>`;
  }

  return (
    `<svg class="covmap" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `role="img" aria-label="Kapsama ve yürüyüş izi">${cells}${trailSvg}</svg>`
  );
}

/**
 * Saha kontrol listesi — tarama bütünlüğünü madde madde denetler.
 * Uydurma veri yok: veri olmayan denetim "denetlenemedi" olarak raporlanır.
 *
 * @returns {{ verdict: "tam"|"dikkat"|"eksik", verdictLabel: string,
 *             items: Array<{ status: "ok"|"warn"|"fail", text: string, detail?: string }> }}
 */
export function buildScanChecklist(input = {}) {
  const coverage = input.coverage || null;
  const scan = input.scan || {};
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const trail = Array.isArray(input.trail) ? input.trail : [];
  const items = [];

  // 1 — Matris kapsaması (atlanan kareler)
  if (coverage) {
    const missed = Number(coverage.unvisitedCount) || 0;
    const visited = Number(coverage.visitedCount) || 0;
    const total = Number(coverage.totalCells) || visited + missed;
    if (missed === 0) {
      items.push({ status: "ok", text: `Matris kapsaması tam — ${visited}/${total} kare ölçüldü` });
    } else {
      items.push({
        status: (Number(coverage.coverage) || 0) < 0.5 ? "fail" : "warn",
        text: `Matris kapsaması eksik — ${missed}/${total} kare atlandı`,
        detail: missedCellsList(coverage.unvisited),
      });
    }
    if (coverage.boundsFromField === false) {
      items.push({
        status: "warn",
        text: "Alan tanımı yok — kapsama veri sınırlarından hesaplandı; kenar kare tespiti güvenilir değil",
      });
    }
  } else {
    items.push({ status: "warn", text: "Kapsama denetlenemedi — matris tanımlı değil" });
  }

  // 2 — Yürüyüş izi
  if (trail.length > 1) {
    let distanceM = 0;
    for (let i = 1; i < trail.length; i++) {
      distanceM += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y) / HEAT_PX_PER_M;
    }
    items.push({
      status: "ok",
      text: `Yürüyüş izi kayıtlı — ${trail.length} örnek · ~${distanceM.toFixed(1)} m`,
    });
  } else if (trail.length === 1) {
    items.push({ status: "warn", text: "Yürüyüş izi tek örnekten ibaret" });
  } else {
    items.push({ status: "warn", text: "Yürüyüş izi yok" });
  }

  // 3 — Veri bütünlüğü
  const dropped = Number(scan.droppedCount) || 0;
  items.push(
    dropped > 0
      ? { status: "warn", text: `${dropped} bozuk satır atlandı — ham veri eksik olabilir` }
      : { status: "ok", text: "Bozuk satır yok — tüm mesajlar çözümlendi" }
  );

  // 4 — Hedef kararları ve kanıt tekrarı
  if (targets.length) {
    const pending = targets.filter((t) => {
      const s = String(t.status || "unverified").toLowerCase();
      return s !== "confirmed" && s !== "rejected";
    });
    items.push(
      pending.length === 0
        ? { status: "ok", text: `Tüm hedefler karara bağlandı (${targets.length})` }
        : { status: "warn", text: `${pending.length}/${targets.length} hedef karar bekliyor` }
    );
    const single = targets.filter(
      (t) => (Array.isArray(t.detectionIds) ? t.detectionIds.length : 0) < 2
    );
    items.push(
      single.length === 0
        ? { status: "ok", text: "Her hedef en az iki kanıtta tekrar görüldü" }
        : { status: "warn", text: `${single.length} hedef tek kanıtta — çapraz doğrulama önerilir` }
    );
  } else {
    items.push({ status: "ok", text: "Karar bekleyen hedef yok" });
  }

  const fail = items.some((i) => i.status === "fail");
  const warn = items.some((i) => i.status === "warn");
  const verdict = fail ? "eksik" : warn ? "dikkat" : "tam";
  return { verdict, verdictLabel: CHECKLIST_VERDICTS[verdict], items };
}

function checklistSectionHtml(checklist) {
  const verdictClass = { tam: "st-ok", dikkat: "st-warn", eksik: "st-fail" }[checklist.verdict];
  const items = checklist.items
    .map((item) => {
      const icon = item.status === "ok" ? "✓" : item.status === "fail" ? "✗" : "⚠";
      const detail = item.detail ? ` <span class="detail">(${esc(item.detail)})</span>` : "";
      return `<li class="st-${item.status}">${icon} ${esc(item.text)}${detail}</li>`;
    })
    .join("");
  return (
    `<h2>Saha kontrol listesi</h2>` +
    `<div class="verdict ${verdictClass}">${esc(checklist.verdictLabel)}</div>` +
    `<ul class="checklist">${items}</ul>`
  );
}

function coverageSectionHtml(coverage, scan, trail) {
  const rows = Math.floor(coverage?.rows || scan.matrixRows || 0);
  const cols = Math.floor(coverage?.cols || scan.matrixCols || 0);
  const matrixText = `${rows || "?"}×${cols || "?"}`;
  if (!coverage) {
    return (
      `<h2>Kapsama · ${matrixText} matris</h2>` +
      `<p class="note">Kapsama hesaplanamadı: satır × sütun matrisi tanımlı değil. ` +
      `Atlanan kare tespiti için matris girdilerini girin.</p>`
    );
  }

  const missed = Array.isArray(coverage.unvisited) ? coverage.unvisited : [];
  const missedText = missed.length
    ? `Atlanan kareler (${missed.length}): ${missedCellsList(missed)}`
    : "Atlanan kare yok — tüm kareler en az bir ölçüm aldı.";

  const notes = [];
  if (coverage.boundsFromField === false) {
    notes.push(
      "Alan tanımı yok — kapsama veri sınırlarından hesaplandı; eksik kenar kare tespiti bu modda güvenilir değildir."
    );
  }
  if (Number(coverage.outOfFieldCount) > 0) {
    notes.push(`${Math.floor(coverage.outOfFieldCount)} ölçüm tanımlı alan dışında kaldı.`);
  }

  return (
    `<h2>Kapsama · ${matrixText} matris · ${pctText(coverage.coverage)}</h2>` +
    buildCoverageTrailSvg(coverage, trail) +
    `<p class="note">${esc(missedText)}</p>` +
    notes.map((n) => `<p class="note warn">${esc(n)}</p>`).join("")
  );
}

/** Ek: 3D sahne görüntüsü — seçili hedeflerin tek karelik görünümü. */
function sceneSectionHtml(sceneImage, sceneCaption) {
  if (!sceneImage) {
    return (
      `<h2>Ek · 3D sahne görüntüsü</h2>` +
      `<p class="note">3D sahne görüntüsü eklenemedi — görüntü yakalama başarısız oldu.</p>`
    );
  }
  return (
    `<h2>Ek · 3D sahne görüntüsü</h2>` +
    `<img class="scene" src="${esc(sceneImage)}" alt="3D sahne" />` +
    (sceneCaption ? `<p class="note">${esc(sceneCaption)}</p>` : "")
  );
}

function targetsSectionHtml(targets) {
  if (!targets.length) {
    return `<h2>Hedef listesi</h2><p class="note">Bu taramada birleşik hedef yok.</p>`;
  }
  const sorted = [...targets].sort(
    (a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0)
  );
  const rows = sorted
    .map((t) => {
      const status = String(t.status || "unverified").toLowerCase();
      const label = REPORT_STATUS_LABELS[status] || REPORT_STATUS_LABELS.unverified;
      const accent = STATUS_ACCENTS[status] || STATUS_ACCENTS.unverified;
      const evidence = Array.isArray(t.detectionIds) ? t.detectionIds.length : Number(t.evidenceCount) || 0;
      return (
        `<tr>` +
        `<td class="mono">${esc(t.targetId)}</td>` +
        `<td>${evidence || "—"}</td>` +
        `<td>${fmtDepth(t.depthTopM, t.depthBottomM)}</td>` +
        `<td>${pctText(t.confidence)}</td>` +
        `<td style="color:${accent};font-weight:600;">${esc(label)}</td>` +
        `</tr>`
      );
    })
    .join("");
  return (
    `<h2>Hedef listesi</h2>` +
    `<table class="targets">` +
    `<thead><tr><th>Hedef</th><th>Kanıt</th><th>Derinlik</th><th>Güven</th><th>Operatör kararı</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/**
 * Tek sayfalık saha raporu HTML'i üretir.
 *
 * @param {object} input
 * @param {object} [input.source] {{ fileName?, fingerprint? }}
 * @param {object} [input.scan] {{ matrixRows?, matrixCols?, fieldWidthM?, fieldLengthM?,
 *                                pointCount?, messageCount?, droppedCount? }}
 * @param {object|null} [input.coverage] computeScanCoverage çıktısı
 * @param {Array} [input.targets] {{ targetId, detectionIds, depthTopM, depthBottomM,
 *                                  confidence, status }} — durum önceden hesaplanmış
 * @param {string} [input.sceneImage] 3D sahne görüntüsü (data URL) — ek olarak basılır
 * @param {string} [input.sceneCaption] sahne görüntüsü alt yazısı
 * @param {number} [input.sensitivityPercent] %0-100 yapı hassasiyeti — tekrar
 *   üretilebilirlik için altbilgiye yazılır
 * @param {string} [input.generatedAt] ISO tarih
 * @returns {string} yazdırılabilir tek sayfa HTML
 */
export function buildLegacyFieldReportHtml(input = {}) {
  const source = input.source || {};
  const scan = input.scan || {};
  const coverage = input.coverage || null;
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const sceneImage = String(input.sceneImage || "");
  const sceneCaption = String(input.sceneCaption || "");
  const trail = Array.isArray(input.trail) ? input.trail : [];
  const checklist = buildScanChecklist({ coverage, scan, targets, trail });
  const generatedAt = String(input.generatedAt || new Date().toISOString());
  const dateText = generatedAt.slice(0, 19).replace("T", " ");
  const fingerprint = String(source.fingerprint || "");
  const fingerprintShort = fingerprint ? fingerprint.slice(0, 12) : "—";
  const sensLine = sensitivityFooterLine(input.sensitivityPercent);

  const confirmedCount = targets.filter(
    (t) => String(t.status || "").toLowerCase() === "confirmed"
  ).length;
  const coveragePct = coverage ? pctText(coverage.coverage) : "—";

  const scanLine =
    `Matris ${Math.floor(scan.matrixRows || coverage?.rows || 0)}×${Math.floor(scan.matrixCols || coverage?.cols || 0)}` +
    ` · Alan ${scan.fieldWidthM != null ? esc(scan.fieldWidthM) : "?"}×${scan.fieldLengthM != null ? esc(scan.fieldLengthM) : "?"} m` +
    ` · ${Math.floor(Number(scan.pointCount) || 0)} nokta` +
    ` · ${Math.floor(Number(scan.messageCount) || 0)} mesaj` +
    (Number(scan.droppedCount) > 0 ? ` · ${Math.floor(Number(scan.droppedCount))} bozuk satır` : "");

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>VOTEX Saha Raporu</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 14px 16px; font-family: "Segoe UI", Arial, sans-serif; color: #14202e; background: #fff; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 12.5px; margin: 10px 0 4px; border-bottom: 1px solid #cdd8e6; padding-bottom: 2px; }
  .sub { color: #56657a; font-size: 10.5px; margin-bottom: 2px; }
  .mono { font-family: Consolas, "Courier New", monospace; }
  .stats { display: flex; gap: 6px; margin: 8px 0 2px; }
  .stat { flex: 1; border: 1px solid #cdd8e6; border-radius: 4px; padding: 5px 7px; }
  .stat span { display: block; color: #56657a; font-size: 9.5px; }
  .stat b { font-size: 15px; }
  table.covgrid { border-collapse: collapse; }
  table.covgrid td { width: 22px; height: 16px; border: 1px solid #8fa3ba; text-align: center; font-size: 10px; color: #c22c2c; }
  table.covgrid td.on { background: #d3ecdd; }
  table.covgrid td.off { background: #f7d4d4; }
  table.targets { width: 100%; border-collapse: collapse; }
  table.targets th, table.targets td { border: 1px solid #cdd8e6; padding: 3px 6px; text-align: left; font-size: 11px; }
  table.targets th { background: #eef3f9; }
  .note { color: #3c4a5c; font-size: 10.5px; margin: 3px 0; }
  .note.warn { color: #b57708; }
  .verdict { display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; margin: 3px 0; }
  .verdict.st-ok { background: #d3ecdd; color: #1f8a55; }
  .verdict.st-warn { background: #f7ecd4; color: #b57708; }
  .verdict.st-fail { background: #f7d4d4; color: #c22c2c; }
  ul.checklist { list-style: none; margin: 4px 0 0; padding: 0; }
  ul.checklist li { font-size: 10.5px; margin: 2px 0; }
  ul.checklist li.st-ok { color: #1f8a55; }
  ul.checklist li.st-warn { color: #b57708; }
  ul.checklist li.st-fail { color: #c22c2c; }
  ul.checklist .detail { color: #56657a; }
  svg.covmap { display: block; margin: 3px 0; border: 1px solid #cdd8e6; border-radius: 4px; }
  img.scene { display: block; max-width: 100%; max-height: 92mm; margin-top: 3px; border: 1px solid #cdd8e6; border-radius: 4px; }
  .footer { margin-top: 10px; border-top: 1px solid #cdd8e6; padding-top: 5px; color: #56657a; font-size: 9.5px; }
</style>
</head>
<body>
  <h1>VOTEX · Saha Raporu</h1>
  <div class="sub">Otomatik üretilmiştir · <span class="mono">${esc(dateText)}</span> · ${esc(source.fileName || "—")}</div>
  <div class="sub mono">kaynak parmak izi: ${esc(fingerprintShort)}</div>
  <div class="sub">${scanLine}</div>
  <div class="stats">
    <div class="stat"><span>Kapsama</span><b>${coveragePct}</b></div>
    <div class="stat"><span>Nokta</span><b>${Math.floor(Number(scan.pointCount) || 0)}</b></div>
    <div class="stat"><span>Hedef</span><b>${targets.length}</b></div>
    <div class="stat"><span>Onaylı</span><b>${confirmedCount}</b></div>
  </div>
  ${checklistSectionHtml(checklist)}
  ${coverageSectionHtml(coverage, scan, trail)}
  ${targetsSectionHtml(targets)}
  ${sceneSectionHtml(sceneImage, sceneCaption)}
  <div class="footer">
    ${sensLine ? `<div>Hassasiyet: ${esc(sensLine)}</div>` : ""}
    Bu rapor VOTEX tarafından otomatik üretilmiştir — anomali ≠ nesne; nihai doğrulama fiziksel doğrulama
    (kazı / bağımsız ikinci ölçüm) ister. Tam parmak izi: <span class="mono">${esc(fingerprint || "—")}</span>
  </div>
</body>
</html>`;
}
