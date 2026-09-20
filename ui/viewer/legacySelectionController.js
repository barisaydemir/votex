import {
  clearLegacyTargetSession,
  moveDetectionTarget,
  targetSessionForDetection,
  targetSessionForStep,
} from "./legacyTargetSession.js";

export function createLegacySelectionController({ getSession, setSession } = {}) {
  const read = () => (typeof getSession === "function" ? getSession() : null);
  const write = (session) => {
    if (typeof setSession === "function") setSession(session);
    return session;
  };
  return {
    selectStep(stepIndex, input = {}) {
      return write(targetSessionForStep(stepIndex, { ...read(), ...input }));
    },
    selectDetection(detectionId, stepIndex, input = {}) {
      return write(targetSessionForDetection(detectionId, stepIndex, { ...read(), ...input }));
    },
    move(detections, offset, input = {}) {
      return write(moveDetectionTarget(detections, read()?.detectionId, offset, { ...read(), ...input }));
    },
    clear(input = {}) {
      return write(clearLegacyTargetSession({ ...read(), ...input }));
    },
  };
}
