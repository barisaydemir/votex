/**
 * Legacy vaka sözleşmesi.
 * Analiz sonucu yeniden üretilebilir; saha gözlemi ise operatör kararıdır ve
 * yeniden analiz edildiğinde korunmalıdır.
 */

export const CASE_SCHEMA_VERSION = 2;
export const CONTENT_HASH_ALGORITHM = "fnv1a32";
export const ANALYSIS_SCHEMA_VERSION = 1;

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Synchronous and deterministic fallback hash for WebView and test runtimes. */
export function contentFingerprint(content, fileName = "") {
  const text = String(content ?? "");
  return `json-v${CASE_SCHEMA_VERSION}-${hashText(text)}`;
}

function stableParams(params = {}) {
  if (!params || typeof params !== "object") return {};
  return Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}

export function analysisRevisionOf(result, params = {}) {
  if (!result || typeof result !== "object") return null;
  const algorithmVersion = String(result.algorithmVersion || "legacy-dik-v2");
  const engineFingerprint = String(result.fingerprint || "unknown");
  const normalizedParams = stableParams(params);
  const revisionSeed = `${algorithmVersion}|${engineFingerprint}|${JSON.stringify(normalizedParams)}`;
  return {
    id: `analysis-${hashText(revisionSeed)}`,
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    algorithmVersion,
    engineFingerprint,
    params: normalizedParams,
    createdAt: String(result.analyzedAt || ""),
  };
}

export function analysisResultOf(result, params = {}) {
  if (!result || typeof result !== "object") return null;
  return {
    fingerprint: String(result.fingerprint || ""),
    message: String(result.message || ""),
    scanStepCount: Number(result.scanStepCount) || 0,
    pointCount: Number(result.pointCount) || 0,
    scanSteps: Array.isArray(result.scanSteps) ? result.scanSteps : [],
    shapes: Array.isArray(result.shapes) ? result.shapes : [],
    analyzedAt: String(result.analyzedAt || ""),
    algorithmVersion: String(result.algorithmVersion || "legacy-dik-v2"),
    revision: analysisRevisionOf(result, params),
  };
}

export function normalizeObservation(raw = {}) {
  return {
    reviewed: !!raw.reviewed,
    status: String(raw.status || "unreviewed"),
    note: String(raw.note || ""),
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    report: !!raw.report,
    updatedAt: String(raw.updatedAt || ""),
  };
}

export function createLegacyCase({
  result = null,
  fileName = "",
  content = "",
  observations = {},
  analysisParams = {},
  legacyKeys = [],
} = {}) {
  const analysis = analysisResultOf(result, analysisParams);
  const contentHash = content ? contentFingerprint(content, fileName) : "";
  const engineFingerprint = String(result?.fingerprint || "");
  const fallbackKey = contentHash || engineFingerprint || String(fileName || "");
  const aliases = [...new Set([
    ...legacyKeys,
    engineFingerprint,
    fileName,
  ].map((value) => String(value || "").trim()).filter(Boolean).filter((value) => value !== fallbackKey))];
  const normalizedObservations = {};
  for (const [id, value] of Object.entries(observations || {})) {
    normalizedObservations[String(id)] = normalizeObservation(value);
  }
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    source: {
      fingerprint: fallbackKey,
      contentHash: contentHash || null,
      hashAlgorithm: contentHash ? CONTENT_HASH_ALGORITHM : null,
      fileName: String(fileName || ""),
      analysisVersion: analysis?.algorithmVersion || "",
      legacyKeys: aliases,
    },
    analysis,
    analysisRevisions: analysis?.revision ? [analysis.revision] : [],
    observations: normalizedObservations,
    updatedAt: new Date().toISOString().slice(0, 19),
  };
}

export function setObservation(caseModel, detectionId, patch = {}) {
  if (!caseModel || detectionId == null) return caseModel;
  const id = String(detectionId);
  return {
    ...caseModel,
    observations: {
      ...(caseModel.observations || {}),
      [id]: normalizeObservation({ ...(caseModel.observations?.[id] || {}), ...patch }),
    },
    updatedAt: new Date().toISOString().slice(0, 19),
  };
}

export function migrateLegacyCase(raw, fallback = {}) {
  if (!raw || typeof raw !== "object") return createLegacyCase(fallback);
  const base = createLegacyCase(fallback);
  const rawRevisions = Array.isArray(raw.analysisRevisions) ? raw.analysisRevisions : [];
  const source = { ...base.source, ...(raw.source || {}) };
  const legacyKeys = [...new Set([
    ...(Array.isArray(source.legacyKeys) ? source.legacyKeys : []),
    source.fingerprint,
    source.fileName,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  return {
    ...base,
    ...raw,
    schemaVersion: CASE_SCHEMA_VERSION,
    source: { ...source, legacyKeys },
    analysis: raw.analysis ? { ...base.analysis, ...raw.analysis } : base.analysis,
    analysisRevisions: rawRevisions.length ? rawRevisions : (base.analysisRevisions || []),
    observations: Object.fromEntries(Object.entries(raw.observations || {}).map(([id, value]) => [id, normalizeObservation(value)])),
    migration: {
      fromSchemaVersion: Number(raw.schemaVersion) || 1,
      migratedAt: new Date().toISOString().slice(0, 19),
      legacyKeys,
    },
  };
}
