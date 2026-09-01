import { t, tPhrase } from "./index.js";

export function metalCueTitle(m, { short = false } = {}) {
  const cue = m.cueKind ?? m.cue_kind ?? "field";
  const guess = m.metalGuess ?? m.metal_guess ?? "";
  const host = m.hostKind ?? m.host_kind ?? "";
  const inside = !!(m.insideChamber ?? m.inside_chamber);
  const hosted =
    host === "shaft" ||
    host === "tomb" ||
    host === "tunnel" ||
    host === "room" ||
    inside;
  let cueName;
  if (cue === "metal") {
    if (guess === "au_ag_fe") cueName = t("metal.strong");
    else if (guess === "iron") cueName = short ? t("metal.ferroShort") : t("metal.iron");
    else cueName = short ? t("metal.ferroBare") : t("metal.ferro");
  } else if (cue === "oxidation") {
    cueName = short ? t("metal.oxShort") : t("metal.ox");
  } else if (cue === "surface_exit") {
    cueName = hosted ? t("metal.inside") : t("metal.exit");
  } else {
    cueName = t("metal.field");
  }
  const hostBit =
    host === "shaft"
      ? t("metal.hostShaft")
      : host === "tomb"
        ? t("metal.hostTomb")
        : host === "tunnel"
          ? t("metal.hostTunnel")
          : host === "room"
            ? t("metal.hostRoom")
            : inside
              ? t("metal.hostStruct")
              : "";
  return `${cueName}${hostBit}`;
}

export function chamberKindLabel(kind) {
  if (kind === "shaft") return t("sc.shaft");
  if (kind === "tomb") return t("sc.tomb");
  return t("sc.room");
}

export function waterLabelOf(wtr) {
  return tPhrase(wtr?.geometry?.label || wtr?.geometry?.method || t("sc.possibleWater"));
}

/** Güçlü merkez varsayımı: altın / gümüş / demir (au_ag_fe). */
export function isValuableMetal(m) {
  const guess = String(m?.metalGuess ?? m?.metal_guess ?? "");
  return guess === "au_ag_fe";
}
