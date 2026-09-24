import { describe, it, expect } from "vitest";
import {
  bumpVersion,
  syncCargoToml,
  syncTauriConf,
  syncIss,
  syncPackagerPy,
  changelogSection,
} from "./release.mjs";

describe("release.mjs — sürüm senkronizasyonu", () => {
  it("patch/minor/major artırımı ve doğrudan sürüm", () => {
    expect(bumpVersion("0.4.118", "patch")).toBe("0.4.119");
    expect(bumpVersion("0.4.118", "minor")).toBe("0.5.0");
    expect(bumpVersion("0.4.118", "major")).toBe("1.0.0");
    expect(bumpVersion("0.4.118", "0.5.0")).toBe("0.5.0");
    expect(bumpVersion("0.4.118")).toBe("0.4.119");
  });

  it("Cargo.toml'da yalnız [package] sürümünü değiştirir", () => {
    const toml =
      '[package]\nname = "votex"\nversion = "0.4.118"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n';
    const out = syncCargoToml(toml, "0.4.119");
    expect(out).toContain('name = "votex"\nversion = "0.4.119"');
    expect(out).toContain('serde = { version = "1.0"');
  });

  it("tauri.conf.json sürüm + pencere başlığını günceller", () => {
    const conf =
      '{\n  "$schema": "../gen/schemas/desktop-schema.json",\n  "version": "0.4.118",\n  "app": {\n    "windows": [\n      {\n        "title": "Votex 0.4.118 — Magnetic Anomaly Analysis"\n      }\n    ]\n  }\n}\n';
    const out = syncTauriConf(conf, "0.4.119");
    expect(out).toContain('"version": "0.4.119"');
    expect(out).toContain('"title": "Votex 0.4.119 — Magnetic Anomaly Analysis"');
  });

  it("ISS sürüm + çıktı adını günceller", () => {
    const iss =
      "#define MyAppName \"DFT Suite\"\n#define MyAppVersion \"0.4.118\"\n\n[Setup]\nOutputBaseFilename=DFT_Suite_Setup_0.4.118\n";
    const out = syncIss(iss, "0.4.119");
    expect(out).toContain('#define MyAppVersion "0.4.119"');
    expect(out).toContain("OutputBaseFilename=DFT_Suite_Setup_0.4.119");
  });

  it("build_single_setup.py PACKAGE_VERSION günceller", () => {
    const py = 'PACKAGE_VERSION = "0.4.118"\nPACKAGE_NAME = "DFT_Suite"\n';
    expect(syncPackagerPy(py, "0.4.119")).toContain('PACKAGE_VERSION = "0.4.119"');
  });

  it("CHANGELOG bölümü üretir (notlar + setup satırı)", () => {
    const section = changelogSection({
      version: "0.4.119",
      dateText: "24 Eylül 2026",
      title: "Release otomasyonu",
      bullets: ["İlk not", "İkinci not"],
      setupBuilt: true,
    });
    expect(section).toContain("## 0.4.119 — 24 Eylül 2026");
    expect(section).toContain("### Release otomasyonu");
    expect(section).toContain("- İlk not");
    expect(section).toContain("- VOTEX 0.4.119 Windows setup üretildi.");
  });

  it("not yoksa bakım sürümü varsayılanı, setup atlanınca satır yok", () => {
    const section = changelogSection({
      version: "0.4.119",
      dateText: "24 Eylül 2026",
      title: "Bakım",
      bullets: [],
      setupBuilt: false,
    });
    expect(section).toContain("- Bakım sürümü.");
    expect(section).not.toContain("setup üretildi");
  });
});
