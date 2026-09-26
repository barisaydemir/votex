import { createLegacyCase, setObservation as setCaseObservation } from "./legacyCaseModel.js";
import {
  createLegacyTargetSession,
  clearLegacyTargetSession,
  targetSessionForStep,
  targetSessionForDetection,
} from "./legacyTargetSession.js";
import { toggleTargetInReport, recordVisit, setTargetCheckStatus } from "./legacyFieldSession.js";

/**
 * Lightweight Legacy vaka store.
 *
 * It deliberately wraps the existing application state instead of replacing it
 * in one pass. Commands are the only place where case-level observation/report
 * state is changed, which gives the panel and controllers a stable migration
 * boundary.
 */
export function createLegacyCaseStore(appState) {
  const state = appState || {};

  const currentSession = () => state.legacyFieldSessionController?.session || null;

  const setSession = (session) => {
    state.legacyFieldSessionController?.setSession?.(session);
    return session;
  };

  const syncObservation = (detectionId, patch = {}) => {
    state.legacyCase = setCaseObservation(state.legacyCase, detectionId, patch);
    if (state.legacyCasePackage) {
      state.legacyCasePackage.operator = {
        ...state.legacyCasePackage.operator,
        observations: { ...(state.legacyCase.observations || {}) },
        reportTargets: [...(state.legacyReportTargetIds || [])],
        targetChecks: { ...(currentSession()?.targetChecks || state.legacyCasePackage.operator.targetChecks || {}) },
      };
      state.legacyCasePackage.updatedAt = new Date().toISOString().slice(0, 19);
    }
    return state.legacyCase;
  };

  return {
    get snapshot() {
      return {
        analysis: state.legacyDikResult,
        fieldModel: state.legacyFieldModel,
        selection: state.legacyTargetSession,
        workflowPhase: state.legacyTargetSession?.workflowPhase || null,
        observations: state.legacyCase?.observations || {},
        reportTargetIds: [...(state.legacyReportTargetIds || [])],
        casePackage: state.legacyCasePackage || null,
      };
    },

    setAnalysis(result, {
      fileName = state.legacyDikFileName,
      content = state.legacyDikRawContent,
      analysisParams = {},
    } = {}) {
      state.legacyDikResult = result || null;
      state.legacyDikFileName = fileName || null;
      state.legacyDikRawContent = content || null;
      state.legacyCase = createLegacyCase({
        result,
        fileName,
        content,
        analysisParams,
        legacyKeys: [state.legacyCase?.source?.fingerprint],
        observations: state.legacyCase?.observations || {},
      });
      return state.legacyCase;
    },

    selectSession(session) {
      state.legacyTargetSession = createLegacyTargetSession(session || {});
      return state.legacyTargetSession;
    },

    selectStep(stepIndex, input = {}) {
      const next = targetSessionForStep(stepIndex, {
        ...state.legacyTargetSession,
        ...input,
        detectionId: null,
      });
      state.legacyTargetSession = next;
      return next;
    },

    selectDetection(detectionId, stepIndex = null, input = {}) {
      const next = targetSessionForDetection(detectionId, stepIndex, {
        ...state.legacyTargetSession,
        ...input,
        visibility: "selected-only",
      });
      state.legacyTargetSession = next;
      return next;
    },

    clearSelection(input = {}) {
      state.legacyTargetSession = clearLegacyTargetSession({
        ...state.legacyTargetSession,
        ...input,
      });
      state.selectedStructureId = null;
      return state.legacyTargetSession;
    },

    markReviewed(detectionId, patch = {}) {
      const id = String(detectionId || "");
      if (!id) return null;
      const session = currentSession();
      if (session) {
        setSession(recordVisit(session, {
          detectionId: id,
          stepIndex: patch.stepIndex ?? state.legacyTargetSession?.stepIndex,
        }));
        void state.legacyFieldSessionController?.persist?.();
      }
      syncObservation(id, { reviewed: true, ...patch });
      return this.snapshot;
    },

    /** Operatör doğrulama kararı: confirmed/rejected — öğrenme katmanının girdisi. */
    setCheckStatus(detectionId, status) {
      const id = String(detectionId || "");
      const next = String(status || "").trim();
      if (!id || !next) return null;
      const session = currentSession();
      if (session) {
        setSession(setTargetCheckStatus(session, id, next));
        void state.legacyFieldSessionController?.persist?.();
      }
      syncObservation(id, { reviewed: true, status: next });
      return this.snapshot;
    },

    toggleReport(detectionId) {
      const id = String(detectionId || "");
      if (!id) return false;
      const ids = new Set((state.legacyReportTargetIds || []).map(String));
      const nextValue = !ids.has(id);
      if (nextValue) ids.add(id);
      else ids.delete(id);
      state.legacyReportTargetIds = [...ids];

      const session = currentSession();
      if (session) {
        const result = toggleTargetInReport(session, id);
        setSession(result.session);
        void state.legacyFieldSessionController?.persist?.();
      }
      syncObservation(id, { reviewed: true, report: nextValue });
      return nextValue;
    },

    setObservation(detectionId, patch = {}) {
      return syncObservation(detectionId, patch);
    },

    clearCase() {
      state.legacyDikResult = null;
      state.legacyFieldModel = null;
      state.legacyCasePackage = null;
      state.legacyCase = null;
      state.legacyReportTargetIds = [];
      state.legacyDikRawContent = null;
      state.legacyDikFileName = null;
      state.selectedStructureId = null;
      state.legacyTargetSession = clearLegacyTargetSession({ source: "case-clear", view: "scene" });
      state.legacyMapViewMode = "full";
      state.legacySelectedMergedTargetId = null;
      state.legacyMergedSplitDetectionIds = [];
      return this.snapshot;
    },
  };
}
