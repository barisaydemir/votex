import { $ } from "../app/state.js";
import { t } from "../i18n/index.js";

const TARGET_HINT_KEYS = {
  auto: { top: "target.topAuto", side: "target.sideAuto" },
  well: { top: "target.topWell", side: "target.sideWell" },
  room: { top: "target.topRoom", side: "target.sideRoom" },
  tunnel: { top: "target.topTunnel", side: "target.sideTunnel" },
  site: { top: "target.topSite", side: "target.sideSite" },
};

export function selectedShotType() {
  const el = document.querySelector('input[name="shot-type"]:checked');
  return el?.value === "top" ? "top" : "side";
}

/** Hedef tipi — dik ve yan çekimde geçerli. */
export function selectedTargetKind() {
  const el = document.querySelector('input[name="target-kind"]:checked');
  const v = el?.value || "auto";
  return ["auto", "well", "room", "tunnel", "site"].includes(v) ? v : "auto";
}

export function targetKindLabel(kind = selectedTargetKind()) {
  return t(`target.${kind}`) || t("target.auto");
}

export function updateShotHint() {
  const side = selectedShotType() === "side";
  const hint = $("shot-hint");
  const legend = document.querySelector(".compass-legend");
  const wrap = $("target-kind-wrap");
  const targetHint = $("target-hint");
  const kind = selectedTargetKind();
  const keys = TARGET_HINT_KEYS[kind] || TARGET_HINT_KEYS.auto;

  if (hint) {
    hint.textContent = side ? t("shot.hintSide") : t("shot.hintTop");
  }
  if (legend) {
    legend.textContent = side ? t("shot.legendSide") : t("shot.legendTop");
  }
  if (wrap) {
    wrap.hidden = false;
  }
  if (targetHint) {
    targetHint.textContent = t(side ? keys.side : keys.top);
  }
}
