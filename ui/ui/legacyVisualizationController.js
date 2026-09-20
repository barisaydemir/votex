import { toggleLegacyTomography } from "../viewer/legacyTomography.js";
import { toggleLegacySubsurfaceMap } from "../viewer/legacySubsurfaceMap.js";
import { toggleLegacyUnifiedObjectMap } from "../viewer/legacyUnifiedObjectMap.js";
import { removeLegacyUndergroundMap } from "../viewer/legacyUndergroundMap.js";
import { toggleLegacyGeothermalMap } from "../viewer/legacyGeothermalMap.js";
import { toggleLegacyDepthMap } from "../viewer/legacyDepthMap.js";
import { toggleLegacyInvertProxy } from "../viewer/legacyDikOverlay.js";

export function bindLegacyVisualizationToggles({ get, state, sync, setStatus } = {}) {
  get("btn-legacy-tomography")?.addEventListener("click", () => {
    const enabled = toggleLegacyTomography(state.legacyDikResult);
    const button = get("btn-legacy-tomography");
    if (button) {
      button.textContent = enabled ? "▦ Tomografi: Açık" : "▦ Tomografi";
      button.classList.toggle("accent", enabled);
      button.setAttribute("aria-pressed", String(enabled));
    }
    sync.tomography();
  });

  get("btn-legacy-subsurface")?.addEventListener("click", () => {
    toggleLegacySubsurfaceMap(state.legacyDikResult);
    sync.subsurface();
  });

  const undergroundHandler = () => {
    // Eski dilim/raf katmanı ayrı kalır; birleşik obje düğmesi açılırken
    // yalnızca bu görünümün sahneyi kaplamasını önlemek için kapatılır.
    removeLegacyUndergroundMap();
    const enabled = toggleLegacyUnifiedObjectMap();
    sync.underground?.();
    setStatus(enabled
      ? "Birleşik obje haritası oluşturuldu · ilişkili bulgular tek hacimde birleştirildi"
      : "Birleşik obje haritası kapatıldı");
  };
  get("btn-legacy-underground-top")?.addEventListener("click", undergroundHandler);
  get("btn-legacy-underground")?.addEventListener("click", undergroundHandler);

  get("btn-legacy-geothermal")?.addEventListener("click", () => {
    toggleLegacyGeothermalMap(state.legacyDikResult);
    if (!state.legacyGeothermalMapVisible) state.legacyGeothermalAiText = null;
    sync.geothermal();
  });

  get("btn-legacy-depth")?.addEventListener("click", () => {
    toggleLegacyDepthMap(state.legacyDikResult);
    sync.depth();
  });

  get("btn-legacy-invert")?.addEventListener("click", () => {
    const on = toggleLegacyInvertProxy();
    sync.invert();
    setStatus(on ? "Invert proxy açık — uydurma ayak izi (CAD değil)" : "Invert proxy kapalı");
  });
}
