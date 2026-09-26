/** DOM-only Legacy saha workflow view. Domain state is supplied by callbacks. */

export function renderLegacyWorkflowView({ root, enabled, steps, onNext } = {}) {
  if (!root || !enabled) return;
  const completed = steps.filter((step) => step.done).length;
  const next = steps.find((step) => !step.done);
  root.querySelector("#legacy-workflow-progress")?.replaceChildren(
    document.createTextNode(`${completed}/${steps.length} tamamlandı`)
  );
  root.querySelector("#legacy-workflow-title")?.replaceChildren(
    document.createTextNode(
      completed === steps.length
        ? "Hedef kaydı tamamlandı · başka hedefe geçebilirsiniz"
        : `Sıradaki: ${next?.label || "—"}`
    )
  );
  const list = root.querySelector("#legacy-workflow-steps");
  if (list) {
    list.innerHTML = steps
      .map((step) => `<span class="legacy-workflow-step${step.done ? " is-done" : step === next ? " is-next" : ""}">${step.done ? "✓ " : ""}${step.label}</span>`)
      .join("");
  }
  const button = root.querySelector("#btn-legacy-workflow-next");
  if (button) {
    button.disabled = !next;
    button.textContent = next?.key === "json" ? "JSON seç"
      : next?.key === "step" ? "İlk adıma git"
        : next?.key === "target" ? "İlk hedefi seç"
          : next?.key === "focus" ? "Hedefe git"
            : "Not / fotoğraf ekle";
    button.onclick = next ? onNext : null;
  }
}
