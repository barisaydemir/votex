/**
 * legacyFieldSession.js — JSON fingerprint anahtarlı saha inceleme oturumu.
 *
 * Amaç: kullanıcı bir Legacy JSON'u inceledikten sonra uygulama kapansa bile
 * hangi hedeflerin incelendiği, hangilerinin rapora alındığı ve çalışmanın
 * hangi aşamada kaldığı korunmalıdır. Yeniden açılışta aynı fingerprint'e
 * sahip dosya açıldığında oturum geri yüklenir.
 *
 * DOM veya Three.js bilmez; kalıcı depolama enjekte edilir (Tauri settings veya
 * localStorage), böylece saf birim testleri mümkündür.
 */

export function sessionKeyOf(fingerprint, fileName = "") {
  return String(fingerprint || fileName || "").trim();
}

export function createEmptyFieldSession(key, metadata = {}) {
  return {
    schemaVersion: 3,
    key: String(key || ""),
    contentHash: String(metadata.contentHash || key || ""),
    hashAlgorithm: String(metadata.hashAlgorithm || ""),
    legacyKeys: Array.isArray(metadata.legacyKeys) ? normalizeTargetList(metadata.legacyKeys) : [],
    migration: metadata.migration || null,
    reviewedTargets: [],
    reportTargets: [],
    splitDetectionIds: normalizeTargetList(metadata.splitDetectionIds),
    mergePolicy: metadata.mergePolicy || null,
    lateralCalibration: normalizeLateralCalibration(metadata.lateralCalibration),
    lastTargetId: null,
    lastStepIndex: null,
    targetChecks: {},
    updatedAt: null,
  };
}

export function normalizeTargetList(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return [...new Set(list.map((item) => String(item)).filter(Boolean))];
}

export function normalizeLateralCalibration(raw) {
  if (!raw || typeof raw !== "object") return null;
  const readings = (Array.isArray(raw.readings) ? raw.readings : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3);
  const positive = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  };
  const referenceDepthM = positive(raw.referenceDepthM ?? raw.reference_depth_m) || 1;
  const beforeM = positive(raw.beforeM ?? raw.before_m);
  const afterM = positive(raw.afterM ?? raw.after_m);
  const observedM = positive(raw.observedM ?? raw.observed_m);
  const depthScale = Number(raw.depthScale ?? raw.depth_scale);
  const mode = raw.mode === "field-stake" ? "field-stake" : "single-object";
  if (!readings.length && beforeM == null && afterM == null && observedM == null) return null;
  return {
    schemaVersion: Number(raw.schemaVersion) || 1,
    mode,
    referenceDepthM,
    readings,
    beforeM,
    afterM,
    observedM,
    depthScale: Number.isFinite(depthScale) ? Math.max(0.75, Math.min(1.33, depthScale)) : null,
    quality: String(raw.quality || ""),
    updatedAt: String(raw.updatedAt || ""),
  };
}

export function normalizeFieldSession(raw) {
  const key = String(raw?.key ?? raw?.fingerprint ?? raw?.fileFingerprint ?? "");
  if (!key) return null;
  const checksRaw = raw?.targetChecks && typeof raw.targetChecks === "object" ? raw.targetChecks : {};
  const targetChecks = {};
  for (const [id, check] of Object.entries(checksRaw)) {
    const record = check && typeof check === "object" ? check : null;
    const status = String(record?.status || (typeof check === "string" ? check : "") || "");
    if (!status) continue;
    // Not: "at" alanını yalnız gerçek nesneden oku — String.prototype.at fonksiyonunu yakalama.
    const at = record ? String(record.at || "") : "";
    targetChecks[id] = { status, at };
  }
  return {
    schemaVersion: Number(raw?.schemaVersion) || 1,
    key,
    contentHash: String(raw?.contentHash || key),
    hashAlgorithm: String(raw?.hashAlgorithm || ""),
    legacyKeys: normalizeTargetList(raw?.legacyKeys),
    migration: raw?.migration && typeof raw.migration === "object" ? raw.migration : null,
    reviewedTargets: normalizeTargetList(raw?.reviewedTargets),
    reportTargets: normalizeTargetList(raw?.reportTargets),
    splitDetectionIds: normalizeTargetList(raw?.splitDetectionIds),
    mergePolicy: raw?.mergePolicy && typeof raw.mergePolicy === "object" ? raw.mergePolicy : null,
    lateralCalibration: normalizeLateralCalibration(raw?.lateralCalibration),
    lastTargetId: raw?.lastTargetId == null ? null : String(raw.lastTargetId),
    lastStepIndex: Number.isFinite(Number(raw?.lastStepIndex)) && Number(raw?.lastStepIndex) > 0
      ? Number(raw.lastStepIndex)
      : null,
    targetChecks,
    updatedAt: String(raw?.updatedAt || ""),
  };
}

export function isTargetReviewed(session, detectionId) {
  if (!session || detectionId == null) return false;
  return session.reviewedTargets.includes(String(detectionId));
}

export function isTargetInSessionReport(session, detectionId) {
  if (!session || detectionId == null) return false;
  return session.reportTargets.includes(String(detectionId));
}

/**
 * Hedefi inceleme listesine ekler (idempotent). Yeni hedefse en üste eklenir.
 */
export function markTargetReviewed(session, detectionId) {
  const id = detectionId == null ? null : String(detectionId);
  if (!session || !id) return session;
  if (isTargetReviewed(session, id)) return touch(session);
  return touch({
    ...session,
    reviewedTargets: [id, ...session.reviewedTargets],
    targetChecks: {
      ...session.targetChecks,
      [id]: { status: "reviewed", at: nowIso() },
    },
  });
}

export function setTargetCheckStatus(session, detectionId, status) {
  const id = detectionId == null ? null : String(detectionId);
  const next = String(status || "").trim();
  if (!session || !id || !next) return session;
  const checks = { ...session.targetChecks };
  if (next === "reviewed" && !isTargetReviewed(session, id)) {
    return touch(markTargetReviewed(session, id));
  }
  checks[id] = { status: next, at: nowIso() };
  return touch({ ...session, targetChecks: checks });
}

export function setLateralCalibration(session, snapshot = null) {
  if (!session) return session;
  return touch({
    ...session,
    lateralCalibration: normalizeLateralCalibration(snapshot),
  });
}

export function setMergeReview(session, { splitDetectionIds = [], mergePolicy = null } = {}) {
  if (!session) return session;
  return touch({
    ...session,
    splitDetectionIds: normalizeTargetList(splitDetectionIds),
    mergePolicy: mergePolicy && typeof mergePolicy === "object" ? { ...mergePolicy } : null,
  });
}

export function toggleTargetInReport(session, detectionId) {
  const id = detectionId == null ? null : String(detectionId);
  if (!session || !id) return { session, added: false };
  const wasIn = isTargetInSessionReport(session, id);
  const reportTargets = wasIn
    ? session.reportTargets.filter((item) => item !== id)
    : [id, ...session.reportTargets];
  return {
    session: touch({ ...session, reportTargets }),
    added: !wasIn,
  };
}

export function recordVisit(session, { detectionId = null, stepIndex = null } = {}) {
  if (!session) return session;
  const visitStep = Number.isFinite(Number(stepIndex)) && Number(stepIndex) > 0
    ? Number(stepIndex)
    : null;
  const withTarget = detectionId != null ? markTargetReviewed(session, detectionId) : session;
  return touch({
    ...withTarget,
    lastTargetId: detectionId == null ? withTarget.lastTargetId : String(detectionId),
    lastStepIndex: visitStep ?? withTarget.lastStepIndex,
  });
}

export function sessionProgressOf(session) {
  const reviewed = session?.reviewedTargets?.length || 0;
  const reported = session?.reportTargets?.length || 0;
  const checked = Object.keys(session?.targetChecks || {}).length;
  return { reviewed, reported, checked, hasSession: reviewed + reported + checked > 0 };
}

function touch(session) {
  return { ...session, updatedAt: nowIso() };
}

function nowIso() {
  try {
    return new Date().toISOString().slice(0, 19);
  } catch {
    return "";
  }
}

/**
 * Kalıcı depolama köprüsü. Tauri ortamında getAppSettings/setLegacyFieldSessions
 * kullanılır; testlerde basit bir Map-benzeri stub yeterlidir.
 */
export function createFieldSessionStore({ loadAll, saveAll }) {
  let cache = null;

  async function readAll() {
    if (cache) return cache;
    try {
      const raw = await loadAll();
      const map = {};
      if (raw && typeof raw === "object") {
        for (const [key, value] of Object.entries(raw)) {
          const normalized = normalizeFieldSession({ ...(value || {}), key });
          if (normalized) map[key] = normalized;
        }
      }
      cache = map;
    } catch {
      cache = {};
    }
    return cache;
  }

  return {
    /** fingerprint → oturum veya null */
    async load(fingerprint, fileName = "", aliases = []) {
      const key = sessionKeyOf(fingerprint, fileName);
      if (!key) return null;
      const all = await readAll();
      const candidates = [key, ...((Array.isArray(aliases) ? aliases : [aliases]).map(String).filter(Boolean))];
      const foundKey = candidates.find((candidate) => all[candidate]);
      const found = foundKey ? all[foundKey] : null;
      // Eski motor-fingerprint veya dosya adı anahtarını yeni içerik anahtarına taşı.
      if (found && foundKey !== key) {
        all[key] = {
          ...found,
          schemaVersion: 2,
          key,
          contentHash: key,
          legacyKeys: [...new Set([...(found.legacyKeys || []), foundKey])],
          migration: {
            fromKey: foundKey,
            migratedAt: nowIso(),
          },
        };
        delete all[foundKey];
        cache = all;
        try { await saveAll(pruneSessions(all)); } catch { /* bellek içi migration yeterli */ }
      }
      return all[key] || null;
    },
    async save(session) {
      const normalized = normalizeFieldSession(session);
      if (!normalized) return null;
      const all = await readAll();
      all[normalized.key] = normalized;
      cache = all;
      try {
        await saveAll(pruneSessions(cache));
      } catch {
        /* kalıcı kayıt başarısız olsa da oturum bellek içinde çalışmaya devam eder */
      }
      return normalized;
    },
    async clear(fingerprint, fileName = "") {
      const key = sessionKeyOf(fingerprint, fileName);
      if (!key) return;
      const all = await readAll();
      delete all[key];
      cache = all;
      try {
        await saveAll(cache);
      } catch {
        /* ignore */
      }
    },
  };
}

/** Eski oturumları budayarak settings şişmesini önler (en fazla 40 dosya). */
export function pruneSessions(sessions, max = 40) {
  const entries = Object.entries(sessions || {});
  const sorted = entries.sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")));
  return Object.fromEntries(sorted.slice(0, max));
}
