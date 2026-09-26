/**
 * Canonical Legacy vaka paketi.
 *
 * Ham analiz, türetilmiş saha modeli ve operatör kararlarını tek snapshot'ta
 * buluşturur. DOM/Three.js/Tauri bilmez; panel, overlay ve export katmanları
 * aynı paketi tüketebilir.
 */

export const LEGACY_CASE_PACKAGE_SCHEMA_VERSION = 1;
export const LEGACY_CASE_PACKAGE_FILE_FORMAT = "votex-legacy-case-package";
export const LEGACY_CASE_PACKAGE_FILE_VERSION = 1;

function text(value) {
  return String(value ?? "");
}

function list(value) {
  return Array.isArray(value) ? [...value] : [];
}

function object(value) {
  return value && typeof value === "object" ? value : {};
}

function configOf(options = {}) {
  return {
    mergeProfile: text(options.mergeProfile || "normal"),
    splitDetectionIds: list(options.splitDetectionIds).map(String).sort(),
    fieldCalibrationReadings: list(options.fieldCalibrationReadings).map(Number).filter(Number.isFinite),
    fieldCalibrationReferenceM: options.fieldCalibrationReferenceM == null ? 1 : Number(options.fieldCalibrationReferenceM),
    fieldCalibrationAfterM: options.fieldCalibrationAfterM == null ? null : Number(options.fieldCalibrationAfterM),
    fieldCalibrationObservedM: options.fieldCalibrationObservedM == null ? null : Number(options.fieldCalibrationObservedM),
    fieldCalibrationDepthScale: options.fieldCalibrationDepthScale == null ? null : Number(options.fieldCalibrationDepthScale),
    learnedThresholds: options.learnedThresholds || null,
  };
}

function stableJson(value) {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

export function legacyCasePackageKeyOf(result, options = {}) {
  return `${text(result?.fingerprint || result?.source?.fingerprint || "unknown")}::${stableJson(configOf(options))}`;
}

export function createLegacyCasePackage({
  caseModel = null,
  fieldModel = null,
  session = null,
  learnedThresholds = null,
  options = {},
} = {}) {
  const safeCase = caseModel && typeof caseModel === "object" ? caseModel : null;
  const safeSession = session && typeof session === "object" ? session : null;
  const config = configOf(options);
  const source = object(safeCase?.source);
  const analysis = safeCase?.analysis || fieldModel?.result || null;
  return {
    schemaVersion: LEGACY_CASE_PACKAGE_SCHEMA_VERSION,
    source: {
      fingerprint: text(source.fingerprint || analysis?.fingerprint || fieldModel?.result?.fingerprint),
      contentHash: source.contentHash || null,
      fileName: source.fileName || null,
      legacyKeys: list(source.legacyKeys),
    },
    analysis,
    derived: {
      key: legacyCasePackageKeyOf(fieldModel?.result || analysis, config),
      fieldModel: fieldModel || null,
      scan: options.scan || {
        matrixRows: Number(analysis?.matrixRows) || 0,
        matrixCols: Number(analysis?.matrixCols) || 0,
      },
      depthParams: options.depthParams || null,
      config,
    },
    operator: {
      targetChecks: object(safeSession?.targetChecks),
      notesByDetection: object(options.notesByDetection),
      reviewedTargets: list(safeSession?.reviewedTargets),
      reportTargets: list(safeSession?.reportTargets),
      splitDetectionIds: list(safeSession?.splitDetectionIds),
      observations: {
        ...object(safeSession?.targetChecks),
        ...object(safeCase?.observations),
      },
      lateralCalibration: safeSession?.lateralCalibration || fieldModel?.lateralCalibration || null,
    },
    learning: learnedThresholds || fieldModel?.learnedThresholds || null,
    updatedAt: new Date().toISOString().slice(0, 19),
  };
}

export function legacyCasePackageMatches(packageSnapshot, result, options = {}) {
  if (!packageSnapshot?.derived?.fieldModel) return false;
  const expected = legacyCasePackageKeyOf(result, options);
  return packageSnapshot.derived.key === expected;
}

/**
 * Restores the package-owned state without rebuilding its derived field model.
 * Rendering layers can then receive `derived.fieldModel` directly.
 */
export function restoreLegacyCasePackageState(appState, packageSnapshot, options = {}) {
  const valid = validateLegacyCasePackage(packageSnapshot);
  if (!appState) return valid;
  const operator = object(valid.operator);
  const config = object(valid.derived?.config);
  const calibration = operator.lateralCalibration || valid.derived?.fieldModel?.lateralCalibration || null;
  appState.legacyCasePackage = valid;
  appState.legacyDikResult = valid.analysis;
  appState.legacyFieldModel = valid.derived.fieldModel;
  appState.legacyDikRawContent = options.rawContent ?? appState.legacyDikRawContent ?? null;
  appState.legacyDikFileName = options.fileName || valid.source.fileName || appState.legacyDikFileName || null;
  appState.legacyReportTargetIds = list(operator.reportTargets).map(String);
  appState.legacyMergedSplitDetectionIds = list(operator.splitDetectionIds || config.splitDetectionIds).map(String);
  appState.legacyLearnedThresholds = valid.learning || config.learnedThresholds || null;
  appState.legacyMergeProfile = ["cautious", "normal", "research"].includes(config.mergeProfile)
    ? config.mergeProfile
    : appState.legacyMergeProfile;
  appState.legacyFieldCalibrationReadings = list(calibration?.readings).map(Number).filter(Number.isFinite);
  appState.legacyFieldCalibrationBeforeM = calibration?.beforeM ?? null;
  appState.legacyFieldCalibrationAfterM = calibration?.afterM ?? null;
  appState.legacyFieldCalibrationObservedM = calibration?.observedM ?? null;
  appState.legacyFieldCalibrationDepthScale = calibration?.depthScale ?? null;
  appState.legacyFieldCalibrationRestored = !!calibration;
  if (calibration?.mode === "field-stake" || calibration?.mode === "single-object") {
    appState.legacyDepthCalibrationMode = calibration.mode;
  }
  appState.legacyCase = {
    schemaVersion: 2,
    source: valid.source,
    analysis: valid.analysis,
    observations: { ...object(operator.observations) },
  };
  appState.legacyTargetSession = appState.legacyTargetSession || {
    kind: "none",
    stepIndex: null,
    detectionId: null,
    view: "scene",
    visibility: "step",
  };
  return valid;
}

/** Atomically refreshes the canonical package fields on the application state. */
export function refreshLegacyCasePackage(appState, fieldModel, options = {}) {
  if (!appState) return null;
  const next = createLegacyCasePackage({
    caseModel: appState.legacyCase,
    fieldModel: fieldModel || appState.legacyFieldModel,
    session: appState.legacyFieldSessionController?.session,
    learnedThresholds: appState.legacyLearnedThresholds,
    options,
  });
  if (!appState.legacyFieldSessionController?.session && appState.legacyCasePackage?.operator) {
    next.operator = {
      ...appState.legacyCasePackage.operator,
      ...next.operator,
      targetChecks: {
        ...(appState.legacyCasePackage.operator.targetChecks || {}),
        ...(next.operator.targetChecks || {}),
      },
      observations: {
        ...(appState.legacyCasePackage.operator.observations || {}),
        ...(next.operator.observations || {}),
      },
      reportTargets: next.operator.reportTargets.length
        ? next.operator.reportTargets
        : [...(appState.legacyCasePackage.operator.reportTargets || [])],
      notesByDetection: {
        ...(appState.legacyCasePackage.operator.notesByDetection || {}),
        ...(next.operator.notesByDetection || {}),
      },
    };
  }
  appState.legacyCasePackage = next;
  return next;
}

function packageCandidate(value) {
  if (value?.format === LEGACY_CASE_PACKAGE_FILE_FORMAT) return value.package;
  return value;
}

/** Validates a package file and returns a normalized package or a readable error. */
export function validateLegacyCasePackage(value) {
  const candidate = packageCandidate(value);
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Case Package dosyası JSON nesnesi içermiyor");
  }
  if (Number(candidate.schemaVersion) !== LEGACY_CASE_PACKAGE_SCHEMA_VERSION) {
    throw new Error(`Desteklenmeyen Case Package schema sürümü: ${candidate.schemaVersion ?? "boş"}`);
  }
  if (!candidate.source || typeof candidate.source !== "object") {
    throw new Error("Case Package source alanı eksik");
  }
  if (!candidate.analysis || typeof candidate.analysis !== "object") {
    throw new Error("Case Package analysis alanı eksik");
  }
  if (!candidate.derived?.fieldModel || typeof candidate.derived.fieldModel !== "object") {
    throw new Error("Case Package türetilmiş fieldModel alanı eksik");
  }
  if (!Array.isArray(candidate.derived.fieldModel.detections)) {
    throw new Error("Case Package fieldModel.detections alanı geçersiz");
  }
  return candidate;
}

/** Converts a package to the portable, versioned JSON file representation. */
export function serializeLegacyCasePackage(packageSnapshot, space = 2) {
  const valid = validateLegacyCasePackage(packageSnapshot);
  return `${JSON.stringify({
    format: LEGACY_CASE_PACKAGE_FILE_FORMAT,
    fileVersion: LEGACY_CASE_PACKAGE_FILE_VERSION,
    exportedAt: new Date().toISOString().slice(0, 19),
    package: valid,
  }, null, space)}\n`;
}

/** Parses and validates a portable Case Package JSON file. */
export function parseLegacyCasePackageJson(content) {
  let parsed;
  try {
    parsed = JSON.parse(String(content || ""));
  } catch (error) {
    throw new Error(`Case Package JSON okunamadı: ${error?.message || error}`);
  }
  if (parsed?.format === LEGACY_CASE_PACKAGE_FILE_FORMAT
    && Number(parsed.fileVersion) !== LEGACY_CASE_PACKAGE_FILE_VERSION) {
    throw new Error(`Desteklenmeyen Case Package dosya sürümü: ${parsed.fileVersion ?? "boş"}`);
  }
  return validateLegacyCasePackage(parsed);
}

export function legacyCasePackageFileName(packageSnapshot, now = new Date()) {
  const raw = String(packageSnapshot?.source?.fileName || "legacy-vaka").replace(/\.[^.]+$/, "");
  const pad = (value) => String(value).padStart(2, "0");
  return `${raw || "legacy-vaka"}.votex-case-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
}

/** Returns the archive-list badge state without opening the archive payload. */
export function legacyCasePackageArchiveStatus(entry = {}) {
  const sourceKind = String(entry.sourceKind || entry.source_kind || "image");
  if (sourceKind !== "legacy_dik_json") return null;
  const packageRel = String(entry.casePackageRel || entry.case_package_rel || "");
  const integrityStatus = String(entry.integrityStatus || entry.integrity_status || "");
  if (integrityStatus === "verified") {
    return {
      kind: "verified",
      label: "Case Package · doğrulandı",
      title: "source.json, legacy_result.json ve case_package.json SHA-256 hash'leri eşleşti.",
    };
  }
  if (["mismatch", "missing", "unverified"].includes(integrityStatus)) {
    return {
      kind: integrityStatus,
      label: integrityStatus === "missing"
        ? "Case Package · eksik"
        : integrityStatus === "unverified"
          ? "Case Package · doğrulanmadı"
          : "Case Package · uyuşmazlık",
      title: integrityStatus === "missing"
        ? "Case Package metadata'sı var ancak package dosyası bulunamadı."
        : integrityStatus === "unverified"
          ? "Case Package mevcut ancak SHA-256 metadata'sı bulunmuyor."
          : "Arşiv dosyalarından biri kaydedilmiş SHA-256 hash'iyle eşleşmiyor.",
    };
  }
  if (!packageRel) {
    return {
      kind: "legacy",
      label: "Eski format",
      title: "Bu Legacy arşiv kaydı Case Package içermiyor.",
    };
  }
  const sourceFingerprint = String(entry.sourceFingerprint || entry.source_fingerprint || "");
  const analysisFingerprint = String(entry.analysisFingerprint || entry.analysis_fingerprint || "");
  if (sourceFingerprint && analysisFingerprint) {
    return {
      kind: "matched",
      label: "Case Package · fingerprint eşleşti",
      title: `Case Package mevcut · kaynak: ${sourceFingerprint} · analiz: ${analysisFingerprint}`,
    };
  }
  return {
    kind: "present",
    label: "Case Package mevcut",
    title: "Case Package arşiv kaydı mevcut; fingerprint metadata'sı eksik.",
  };
}
