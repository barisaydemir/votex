export function bindLegacyAiControls({ get, state, interpretGeothermal, syncGeothermalUi, setStatus } = {}) {
  get("btn-legacy-geo-ai")?.addEventListener("click", async () => {
    const button = get("btn-legacy-geo-ai");
    const resultEl = get("legacy-geo-ai-result");
    if (!state.legacyGeothermalMapVisible) return;
    if (button) {
      button.disabled = true;
      button.textContent = "🤖 Yorumlanıyor…";
    }
    if (resultEl) {
      resultEl.hidden = false;
      resultEl.textContent = "Jeotermal proxy özeti hazırlanıyor…";
    }
    try {
      const out = await interpretGeothermal(state.legacyDikResult);
      state.legacyGeothermalAiText = out.text;
      setStatus(out.source === "ai" ? "Jeotermal AI yorumu hazır" : "Jeotermal yerel özet hazır (AI yok)");
    } catch (error) {
      state.legacyGeothermalAiText = `Yorum başarısız: ${error?.message || error}`;
      setStatus("Jeotermal AI yorumu başarısız");
    } finally {
      if (button) button.textContent = "🤖 AI yorumla";
      syncGeothermalUi();
    }
  });
}
