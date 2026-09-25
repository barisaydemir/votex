/**
 * legacyDtaBridge.js — Legacy3DMAG vaka köprüsü (VOTEX → DTA/Gemini bağlamı).
 *
 * Amaç: DTA'nın (Derin Tarama Asistan) Gemini'ye gönderdiği bağlama, VOTEX'in
 * Legacy3DMAG dik çekim vaka özetini kanonik ve kompakt bir metin olarak vermek.
 * Bu bir model eğitimi değil; bağlam (context) ihracıdır.
 *
 * Sözleşme kuralları:
 * - Saf modül: DOM/Three.js bilmez; tüm girdiler opsiyon olarak enjekte edilir.
 * - Ölçüm proxy dilini korur: malzeme kimliği, kesin derinlik iddiası taşımaz.
 * - Boyutu sınırlar: tespit/hedef sayısı ve not önizlemeleri kırpılır; böylece
 *   bağlam token bütçesini aşmaz.
 */

export const LEGACY_DTA_BRIDGE_SCHEMA_VERSION = 1;

const DETECTION_LIMIT = 24;
const MERGED_TARGET_LIMIT = 12;
const NOTE_PREVIEW_LIMIT = 160;

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

/**
 * Vaka özetini üretir. Girdiler VOTEX state'inden açıkça verilir; bu fonksiyon
 * hiçbir global state okumaz.
 * @param {object} input
 * @param {object} [input.casePackage] Canonical Legacy vaka paketi
 * @param {object} [input.fieldModel] buildLegacyFieldModel çıktısı (geçiş uyumluluğu)
 * @param {{ fileName?: string|null, fingerprint?: string|null }} [input.source]
 * @param {{ matrixRows?: number, matrixCols?: number, scanStepCount?: number }} [input.scan]
 * @param {{ sensorHeightM?: number, bipolarSepFactor?: number, dipoleBlend?: number }} [input.depthParams]
 * @param {string} [input.mergeProfile]
 * @param {string[]} [input.reportTargetIds]
 * @param {Record<string, { reviewed?: boolean, status?: string, note?: string, report?: boolean }>} [input.observations]
 * @param {(detectionId: string) => { notes?: string, photos?: Array }} [input.getNotes]
 */
export function buildLegacyDtaCaseBrief(input = {}) {
  const casePackage = input.casePackage && typeof input.casePackage === "object" ? input.casePackage : null;
  const fieldModel = casePackage?.derived?.fieldModel || input.fieldModel || {};
  const detections = Array.isArray(fieldModel.detections) ? fieldModel.detections : [];
  const mergedTargets = Array.isArray(fieldModel.mergedTargets) ? fieldModel.mergedTargets : [];
  const relations = Array.isArray(fieldModel.evidenceRelations) ? fieldModel.evidenceRelations : [];
  const calibration = fieldModel.lateralCalibration || casePackage?.operator?.lateralCalibration || null;
  const reportIds = new Set((casePackage?.operator?.reportTargets || input.reportTargetIds || []).map(String));
  const observations = casePackage?.operator?.observations || (input.observations && typeof input.observations === "object" ? input.observations : {});
  const packageNotes = casePackage?.operator?.notesByDetection || {};
  const getNotes = typeof input.getNotes === "function"
    ? input.getNotes
    : (id) => packageNotes[String(id)] || observations[String(id)] || { notes: "", photos: [] };

  if (!detections.length && !mergedTargets.length && !fieldModel.steps?.length) return null;

  const lateralByDetection = new Map();
  for (const relation of relations) {
    const pct = round(numberOf(relation.scorePct, 0), 0);
    for (const id of [relation.fromDetectionId, relation.toDetectionId]) {
      const key = String(id || "");
      if (!key) continue;
      const best = lateralByDetection.get(key);
      if (best == null || pct > best) lateralByDetection.set(key, pct);
    }
  }

  const detectionBriefs = detections.slice(0, DETECTION_LIMIT).map((detection) => {
    const notes = getNotes(detection.detectionId) || {};
    const observation = observations[String(detection.detectionId)] || {};
    const lateralPct = lateralByDetection.get(String(detection.detectionId));
    return {
      id: String(detection.detectionId || ""),
      stepIndex: detection.stepIndex ?? null,
      type: String(detection.type || "Anomali"),
      stationM: round(numberOf(detection.stationM, 0), 2),
      offsetM: round(numberOf(detection.offsetM, 0), 2),
      depthTopM: round(numberOf(detection.depthTopM, 0), 2),
      depthBottomM: round(numberOf(detection.depthBottomM ?? detection.depthTopM, 0), 2),
      confidencePct: Math.round(numberOf(detection.confidence, 0) * 100),
      strengthSigma: round(numberOf(detection.strength, 0), 1),
      status: String(detection.status || "normal"),
      magneticResponse: String(detection.magneticResponse?.label || ""),
      review: {
        reviewed: !!(observation.reviewed || notes.notes),
        inReport: reportIds.has(String(detection.detectionId)),
        notePreview: clampText(notes.notes),
        photoCount: Array.isArray(notes.photos) ? notes.photos.length : 0,
      },
      lateral: lateralPct == null ? null : { candidate: true, bestScorePct: lateralPct },
    };
  });

  const targetBriefs = mergedTargets.slice(0, MERGED_TARGET_LIMIT).map((target) => ({
    targetId: String(target.targetId || ""),
    type: String(target.type || "Anomali"),
    depthTopM: round(numberOf(target.depthTopM, 0), 2),
    depthBottomM: round(numberOf(target.depthBottomM, 0), 2),
    confidencePct: Math.round(numberOf(target.confidence, 0) * 100),
    evidenceCount: Array.isArray(target.detectionIds) ? target.detectionIds.length : 0,
    stepIndices: Array.isArray(target.stepIndices) ? [...target.stepIndices] : [],
    connectorCount: Array.isArray(target.connectors) ? target.connectors.length : 0,
    evidenceQuality: String(target.evidenceQuality || "single"),
    consistency: String(target.consistency?.level || ""),
    inReport: (target.detectionIds || []).some((id) => reportIds.has(String(id))),
  }));

  const reviewedCount = detectionBriefs.filter((item) => item.review.reviewed).length;
  const reportCount = detectionBriefs.filter((item) => item.review.inReport).length;
  const notesCount = detectionBriefs.filter((item) => item.review.notePreview).length;

  const scan = casePackage?.derived?.scan || input.scan || {};
  const depthParams = casePackage?.derived?.depthParams || input.depthParams || null;
  const mergeProfile = casePackage?.derived?.config?.mergeProfile || input.mergeProfile || "normal";
  const matrix = scan.matrixRows > 0 && scan.matrixCols > 0
    ? `${Math.floor(scan.matrixRows)}x${Math.floor(scan.matrixCols)}`
    : null;

  return {
    schemaVersion: LEGACY_DTA_BRIDGE_SCHEMA_VERSION,
    caseType: "legacy3dmag",
    generatedAt: new Date().toISOString().slice(0, 19),
    source: {
      fileName: casePackage?.source?.fileName || input.source?.fileName || null,
      fingerprint: casePackage?.source?.fingerprint || input.source?.fingerprint || null,
    },
    scan: {
      stepCount: Array.isArray(fieldModel.steps) ? fieldModel.steps.length : 0,
      matrixLabel: matrix,
      detectionCount: detections.length,
      mergedTargetCount: mergedTargets.length,
      truncated: detections.length > DETECTION_LIMIT || mergedTargets.length > MERGED_TARGET_LIMIT,
    },
    detections: detectionBriefs,
    mergedTargets: targetBriefs,
    lateralEvidence: {
      relationCount: relations.length,
      maxScorePct: relations.length ? Math.max(...relations.map((r) => Math.round(numberOf(r.scorePct, 0)))) : 0,
      calibrated: !!calibration?.applied,
      disclaimer: "Lateral yanıt adayı aynı kaynak olasılığıdır; fiziksel bağlantı veya birleşme kararı değildir.",
    },
    calibration: calibration ? {
      mode: String(calibration.mode || "single-object"),
      applied: !!calibration.applied,
      referenceDepthM: round(numberOf(calibration.referenceDepthM, 1), 2),
      observedM: calibration.observedM == null ? null : round(numberOf(calibration.observedM, 0), 2),
      readingCount: numberOf(calibration.readingCount, 0),
      depthScale: calibration.depthScale == null ? null : round(numberOf(calibration.depthScale, 0), 2),
      quality: String(calibration.quality || ""),
    } : null,
    observations: {
      reviewedCount,
      reportCount,
      notesCount,
    },
    depthParams: depthParams ? {
      sensorHeightM: round(numberOf(depthParams.sensorHeightM, 0), 2),
      bipolarSepFactor: round(numberOf(depthParams.bipolarSepFactor, 0), 2),
      dipoleBlend: round(numberOf(depthParams.dipoleBlend, 0), 2),
    } : null,
    mergeProfile: String(mergeProfile),
    disclaimer:
      "Tüm derinlik ve yüzde değerleri ölçümden türetilen proxy'dir; malzeme kimliği veya kesin hedef teşhisi değildir.",
  };
}

/**
 * Brief'i DTA/Gemini bağlamına uygun kompakt Türkçe metne çevirir.
 * Amaç: asistanın saha dilinde cevap verebilmesi için ölçüm-özeti bağlamı.
 */
export function formatLegacyDtaCaseBriefText(brief) {
  if (!brief) return "";
  const lines = [
    "LEGACY3DMAG DİK ÇEKİM VAKA ÖZETİ (VOTEX → DTA bağlamı)",
    brief.disclaimer,
    "",
    "VAKA ÖZELİ · Bu bağlam yalnızca Legacy3DMAG JSON dik taramasıdır. Bu vaka için termal sensör doğrulaması isteme/önerme; recommend_sensor_switch(target=thermal) veya verify_with_thermal aracını çağırma. Bu kuralı diğer ELIC veya sensör analizlerine genelleme.",
    "",
    `Dosya: ${brief.source.fileName || "—"} · fingerprint: ${brief.source.fingerprint || "—"}`,
    `Tarama: ${brief.scan.stepCount} adım${brief.scan.matrixLabel ? ` (${brief.scan.matrixLabel})` : ""} · ${brief.scan.detectionCount} tespit · ${brief.scan.mergedTargetCount} birleşik hedef${brief.scan.truncated ? " · özet kırpıldı" : ""}`,
    `Birleşme profili: ${brief.mergeProfile}${brief.depthParams ? ` · parametre h=${brief.depthParams.sensorHeightM} m, bipolar=${brief.depthParams.bipolarSepFactor}, dipol=%${Math.round(brief.depthParams.dipoleBlend * 100)}` : ""}`,
  ];

  if (brief.calibration) {
    const cal = brief.calibration;
    lines.push(
      cal.applied
        ? `Kalibrasyon: ${cal.mode === "field-stake" ? "1 m referans kazığı" : "tek obje"} · ${cal.readingCount} okuma · ölçülen ${cal.observedM ?? "—"} m · derinlik ölçeği ${cal.depthScale ?? "—"}× · kalite ${cal.quality || "—"}`
        : `Kalibrasyon: uygulandı=false (mod ${cal.mode})`,
    );
  } else {
    lines.push("Kalibrasyon: yok");
  }

  if (brief.lateralEvidence.relationCount) {
    lines.push(
      `Lateral yanıt adayları: ${brief.lateralEvidence.relationCount} ilişki · en yüksek %${brief.lateralEvidence.maxScorePct}${brief.lateralEvidence.calibrated ? " · saha kalibrasyonu uygulandı" : ""}`,
    );
    lines.push(`  ${brief.lateralEvidence.disclaimer}`);
  }

  lines.push("", "TESPİTLER (güçten zayıfa):");
  brief.detections.forEach((detection, index) => {
    const lateral = detection.lateral ? ` · lateral aday %${detection.lateral.bestScorePct}` : "";
    const review = detection.review.reviewed || detection.review.inReport || detection.review.notePreview
      ? ` · incelendi=${detection.review.reviewed ? "evet" : "hayır"} · raporda=${detection.review.inReport ? "evet" : "hayır"}${detection.review.photoCount ? ` · ${detection.review.photoCount} foto` : ""}${detection.review.notePreview ? ` · not: "${detection.review.notePreview}"` : ""}`
      : "";
    lines.push(
      `  #${index + 1} ${detection.id} · Adım ${detection.stepIndex ?? "—"} · ${detection.type} · hat ${detection.stationM} m · offset ${detection.offsetM} m · derinlik ${detection.depthTopM}–${detection.depthBottomM} m · güven %${detection.confidencePct} · ${detection.strengthSigma}σ · ${detection.status}${detection.magneticResponse ? ` · ${detection.magneticResponse}` : ""}${lateral}${review}`,
    );
  });

  if (brief.mergedTargets.length) {
    lines.push("", "BİRLEŞİK HEDEFLER (fiziksel hedef adayları):");
    brief.mergedTargets.forEach((target) => {
      lines.push(
        `  ${target.targetId} · ${target.type} · derinlik ${target.depthTopM}–${target.depthBottomM} m · güven %${target.confidencePct} · ${target.evidenceCount} kanıt · adımlar ${target.stepIndices.join(", ") || "—"} · ${target.connectorCount} bağlantı · kanıt kalitesi ${target.evidenceQuality}${target.consistency ? ` · tutarlılık ${target.consistency}` : ""}${target.inReport ? " · raporda" : ""}`,
      );
    });
  }

  lines.push(
    "",
    `Operatör gözlemleri: ${brief.observations.reviewedCount} incelendi · ${brief.observations.reportCount} raporda · ${brief.observations.notesCount} not`,
    "Görev: Bu özeti saha dilinde yorumla; proxy değerlerini kesin teşhis gibi sunma; termal dışındaki uygun takip/doğrulama adımlarını belirt.",
  );
  return lines.join("\n");
}
