export function bindLegacyDataControls({ get, run, level, clear, setStatus } = {}) {
  get("btn-legacy-dik-pick")?.addEventListener("click", () => { void run(); });
  get("btn-legacy-dik-level")?.addEventListener("click", () => { void level(); });
  get("btn-legacy-dik-clear")?.addEventListener("click", () => {
    clear();
    setStatus("Dik çekim şekilleri temizlendi");
  });
}
