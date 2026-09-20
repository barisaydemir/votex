import {
  exportLegacyDetectionsCsv,
  exportLegacyDetectionsGeoJson,
  exportLegacyFieldSummary,
} from "../viewer/legacyDikExport.js";

export function bindLegacyReportExports({ get, state, readParams,  residualScaleOf, selectedTargetsHtml, getBrief = () => ({}), setStatus } = {}) {
  const detections = () => state.legacyFieldModel?.detections;
  const errorText = (error) => error?.message || String(error);

  get("btn-legacy-export-csv")?.addEventListener("click", async () => {
    const list = detections();
    if (!list?.length) return setStatus("Dışa aktarılacak tespit yok");
    try {
      await exportLegacyDetectionsCsv(list, readParams());
      setStatus(`CSV: ${list.length} tespit dışa aktarıldı`);
    } catch (error) {
      setStatus(`CSV: ${errorText(error)}`);
    }
  });

  get("btn-legacy-export-geojson")?.addEventListener("click", async () => {
    const list = detections();
    if (!list?.length) return setStatus("Dışa aktarılacak tespit yok");
    try {
      await exportLegacyDetectionsGeoJson(list, readParams());
      setStatus(`GeoJSON: ${list.length} tespit dışa aktarıldı`);
    } catch (error) {
      setStatus(`GeoJSON: ${errorText(error)}`);
    }
  });

  get("btn-legacy-export-summary")?.addEventListener("click", async () => {
    const list = detections();
    if (!list?.length) return setStatus("Özet için önce tespit yükleyin");
    try {
      const scale = state.legacyFieldModel?.residualScale || residualScaleOf(state.legacyDikResult);
      await exportLegacyFieldSummary({
        fileName: state.legacyDikFileName || "legacy.json",
        briefHtml: getBrief().html || "",
        briefText: getBrief().text || "",
        residualNote: scale?.display || "residual σ · kalibre nT değil",
        params: readParams(),
        fingerprint: state.legacyDikResult?.fingerprint || "",
        selectedTargetsHtml: selectedTargetsHtml(),
      });
      setStatus("Saha özeti HTML kaydedildi — Yazdır / PDF");
    } catch (error) {
      setStatus(`Saha özeti: ${errorText(error)}`);
    }
  });
}
