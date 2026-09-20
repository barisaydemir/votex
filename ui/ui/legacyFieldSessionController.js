import {
  createEmptyFieldSession,
  createFieldSessionStore,
  sessionKeyOf,
  sessionProgressOf,
  setMergeReview,
} from "../viewer/legacyFieldSession.js";
import { createLegacyCase } from "../viewer/legacyCaseModel.js";

export function createLegacyFieldSessionController({ getSettings, saveSessions, getState } = {}) {
  let active = null;
  let store = null;
  const state = () => (typeof getState === "function" ? getState() : {});

  const getStore = () => {
    if (!store) {
      store = createFieldSessionStore({
        loadAll: async () => {
          const settings = await getSettings();
          return settings?.legacyFieldSessions || settings?.legacy_field_sessions || {};
        },
        saveAll: async (sessions) => saveSessions(sessions),
      });
    }
    return store;
  };

  return {
    get session() { return active; },
    setSession(session) { active = session; return active; },
    sessionKey() {
      const current = state();
      return sessionKeyOf(current.legacyCase?.source?.fingerprint || current.legacyDikResult?.fingerprint || "", current.legacyDikFileName || "");
    },
    async loadCurrent() {
      const current = state();
      const key = this.sessionKey();
      if (!key) { active = null; return null; }
      try {
        const restored = await getStore().load(key, current.legacyDikFileName || "", [current.legacyDikResult?.fingerprint || ""]);
        active = restored || createEmptyFieldSession(key);
      } catch {
        active = createEmptyFieldSession(key);
      }
      return active;
    },
    setMergeReview({ splitDetectionIds = [], mergePolicy = null } = {}) {
      active = setMergeReview(active, { splitDetectionIds, mergePolicy });
      return active;
    },
    async persist() {
      if (!active?.key) return active;
      try { active = await getStore().save(active); } catch { /* memory fallback */ }
      return active;
    },
    progressText() {
      const progress = sessionProgressOf(active);
      if (!progress.hasSession) return "";
      const parts = [];
      if (progress.reviewed) parts.push(`${progress.reviewed} hedef incelendi`);
      if (progress.reported) parts.push(`${progress.reported} rapora ekli`);
      return parts.length ? ` · önceki oturum: ${parts.join(", ")}` : "";
    },
    restoreCase(normalized, fileName) {
      const current = state();
      current.legacyDikResult = normalized || current.legacyDikResult;
      current.legacyDikFileName = fileName || current.legacyDikFileName || null;
      current.legacyReportTargetIds = active ? [...active.reportTargets] : [];
      current.legacyMergedSplitDetectionIds = active ? [...(active.splitDetectionIds || [])] : [];
      const restoredProfile = active?.mergePolicy?.mergeProfile;
      if (["cautious", "normal", "research"].includes(restoredProfile)) {
        current.legacyMergeProfile = restoredProfile;
      }
      current.legacyCase = createLegacyCase({
        result: current.legacyDikResult,
        fileName: current.legacyDikFileName || fileName,
        content: current.legacyDikRawContent || "",
        observations: Object.fromEntries(Object.entries(active?.targetChecks || {}).map(([id, check]) => [id, { reviewed: true, status: check.status }])),
      });
      return active;
    },
  };
}
