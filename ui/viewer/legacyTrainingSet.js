/**
 * legacyTrainingSet.js — Arşivden operatör kararlarıyla etiketli eğitim seti ihracı.
 *
 * Amaç: her arşivdeki Legacy dik çekim vakasını "girdi (ölçüm özeti) → çıktı
 * (operatör kararı)" örneklerine çevirip Gemini few-shot bağlamı veya gelecekteki
 * supervised tuning için JSONL (satır başına bir JSON nesnesi) dosyası üretmek.
 *
 * Sözleşme kuralları:
 * - Saf modül: DOM/Three.js/Tauri bilmez; arşiv kayıtları dışarıdan verilir.
 * - Her örnek kendi başına yeterlidir: mesaj dizisi chat-formatına uygundur.
 * - Ölçüm proxy dili korunur: etiket operatör kararıdır, ölçüm değil.
 * - Boyut sınırları: vaka başına tespit sayısı kırpılır; notlar kısaltılır.
 */

export const LEGACY_TRAINING_SET_SCHEMA_VERSION = 1;

/** Tek vakada etiketlenecek azami tespit sayısı (örnek şişmesini önler). */
export const MAX_DETECTIONS_PER_CASE = 24;

const NOTE_PREVIEW_LIMIT = 200;

function numberOf(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  const f = 10 ** digits;
  return Math.round(Number(value) * f) / f;
}

function clampText(value, limit = NOTE_PREVIEW_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function observationOf(raw) {
  return raw && typeof raw === "object" ? raw : {};
}

function labelOf(observation, notes) {
  if (observation.report || notes.inReport) return "report";
  if (observation.status === "confirmed" || notes.status === "confirmed") return "confirmed";
  if (observation.status === "rejected" || notes.status === "rejected") return "rejected";
  if (observation.reviewed || notes.notes) return "reviewed";
  return null;
}

/**
 * Arşivdeki bir Legacy vakasını eğitim örneklerine çevirir.
 * @param {object} input
 * @param {object} input.casePackage Canonical Legacy vaka paketi
 * @param {object} [input.loaded] Geçiş uyumluluğu için arşiv kaydı
 * @param {object} [input.session] Geçiş uyumluluğu için saha oturumu
 * @param {Record<string, { notes?: string, photos?: Array }>} [input.notesByKey] Geçiş uyumluluğu için notlar
 * @returns {Array<object>} 0..n eğitim örneği
 */
export function buildTrainingExamplesForCase(input = {}) {
  const loaded = input.loaded || {};
  const result = loaded.result || {};
  const casePackage = input.casePackage && typeof input.casePackage === "object" ? input.casePackage : null;
  const fieldModel = casePackage?.derived?.fieldModel || null;
  const detections = Array.isArray(fieldModel?.detections) ? fieldModel.detections : [];
  const session = input.session || null;
  const notesByKey = input.notesByKey && typeof input.notesByKey === "object" ? input.notesByKey : {};

  // Export yolu kanonik csomagdan okur. Eski çağrılarda boş sonuç döndürmek
  // yerine mevcut arşiv girdisini desteklemek, migrasyon sırasında güvenlidir.
  const shapes = fieldModel ? detections : [
    ...(Array.isArray(result.anomalies) ? result.anomalies : []),
    ...(Array.isArray(result.candidates) ? result.candidates : []),
    ...(Array.isArray(result.metals) ? result.metals : []),
  ];
  if (!shapes.length) return [];

  const source = casePackage?.source || loaded.meta || {};
  const fingerprint = String(source.fingerprint || result.fingerprint || loaded.meta?.fingerprint || loaded.meta?.id || "");
  const sourceFileName = String(source.fileName || loaded.meta?.fileName || loaded.meta?.file_name || "legacy_dik.json");
  const sourceResult = casePackage?.analysis || result;
  const caseLabel = `legacy3dmag vakası ${sourceFileName} · tarama ${numberOf(sourceResult.pointCount)} nokta · ${numberOf(sourceResult.metals?.length)} metal · ${numberOf(sourceResult.anomalies?.length)} anomali adayı`;

  const targetChecks = casePackage?.operator?.targetChecks || (session?.targetChecks && typeof session.targetChecks === "object" ? session.targetChecks : {});
  const reportTargets = new Set((casePackage?.operator?.reportTargets || session?.reportTargets || []).map(String));
  const packageObservations = casePackage?.operator?.observations || {};
  const packageNotes = casePackage?.operator?.notesByDetection || {};

  return shapes.slice(0, MAX_DETECTIONS_PER_CASE).map((shape, index) => {
    const id = String(shape.detectionId || `legacy-dik-shape-${index + 1}`);
    const check = observationOf(targetChecks[id] || packageObservations[id]);
    const notes = packageNotes[id] || notesByKey[id] || check;
    const label = labelOf(check, {
      inReport: reportTargets.has(id),
      status: check.status,
      notes: notes.notes,
    });

    const depthTop = round(numberOf(shape.depthTopM, 0));
    const depthBottom = round(numberOf(shape.depthBottomM ?? shape.depthTopM, 0));
    const confidence = Math.round(numberOf(shape.confidence ?? shape.shapeConfidence, 0) * 100);

    const measurementLines = [
      `konum: hat ${round(numberOf(shape.stationM ?? shape.cx, 0))} m · offset ${round(numberOf(shape.offsetM ?? shape.cy, 0))} m`,
      `derinlik aralığı: ${depthTop}–${depthBottom} m`,
      `güven: %${confidence}`,
      `yanıt: ${round(numberOf(shape.strength ?? shape.magSigma ?? 0, 1))}σ`,
    ].join(" · ");

    const measurementText = [
      caseLabel,
      `tespit ${id}: ${measurementLines}`,
      "Not: Değerler ölçümden türetilen proxy'dir; malzeme kimliği veya kesin teşhis değildir.",
    ].join("\n");

    const operatorNote = clampText(notes.notes || "");
    const decisionText = label
      ? `Operatör kararı: ${label}${operatorNote ? `\nSaha notu: "${operatorNote}"` : ""}`
      : "Operatör bu tespiti henüz incelemedi; karar bekleniyor.";

    return {
      schemaVersion: LEGACY_TRAINING_SET_SCHEMA_VERSION,
      source: {
        kind: "votex-legacy-dik",
        archiveId: String(loaded.meta?.id || ""),
        fileName: sourceFileName,
        fingerprint,
        detectionId: id,
        exportedAt: new Date().toISOString().slice(0, 19),
      },
      kind: label || "unreviewed",
      measurement: {
        stationM: round(numberOf(shape.stationM ?? shape.cx, 0)),
        offsetM: round(numberOf(shape.offsetM ?? shape.cy, 0)),
        depthTopM: depthTop,
        depthBottomM: depthBottom,
        confidencePct: confidence,
        strengthSigma: round(numberOf(shape.strength ?? shape.magSigma ?? 0, 1)),
        stepIndex: numberOf(shape.stepIndex, 0) || null,
      },
      operator: {
        label,
        note: operatorNote || null,
        photoCount: Array.isArray(notes.photos) ? notes.photos.length : 0,
      },
      messages: [
        { role: "user", content: measurementText },
        { role: "assistant", content: decisionText },
      ],
    };
  });
}

/**
 * Birden çok arşiv kaydını JSONL metnine çevirir.
 * @param {Array<{ loaded: object, session?: object|null, notesByKey?: object }>} cases
 * @param {{ skipUnreviewed?: boolean }} [options]
 * @returns {{ jsonl: string, exampleCount: number, caseCount: number, skippedCases: number }}
 */
export function formatTrainingSetJsonl(cases, options = {}) {
  const list = Array.isArray(cases) ? cases : [];
  const skipUnreviewed = !!options.skipUnreviewed;
  const rows = [];
  let caseCount = 0;
  let skippedCases = 0;

  for (const entry of list) {
    const examples = buildTrainingExamplesForCase(entry || {});
    const usable = skipUnreviewed ? examples.filter((example) => example.kind !== "unreviewed") : examples;
    if (!usable.length) {
      skippedCases += 1;
      continue;
    }
    caseCount += 1;
    for (const example of usable) {
      rows.push(JSON.stringify(example));
    }
  }

  return {
    jsonl: rows.join("\n") + (rows.length ? "\n" : ""),
    exampleCount: rows.length,
    caseCount,
    skippedCases,
  };
}

/**
 * Standart dosya adı üretir: votex-egitim-YYYYMMDD-HHMM.jsonl
 */
export function trainingFileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `votex-egitim-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.jsonl`;
}
