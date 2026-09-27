import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import {
  auditAll,
  auditPackage,
  PACKAGES,
  suspiciousTraitUses,
  tail,
  testBinaries,
} from "./ci_prep_check.mjs";

const noScan = () => [];

describe("ci_prep_check", () => {
  const dirs = [];

  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), "votex-prep-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("manifest'i olmayan ZORUNLU paket → FAIL", () => {
    const pkg = { label: "temp paket", manifest: "Cargo.toml", required: true };
    const r = auditPackage(pkg, tempDir());
    expect(r.status).toBe("FAIL");
    expect(r.detail).toContain("zorunlu manifest yok");
  });

  it("manifest'i olmayan OPSİYONEL paket → SKIP", () => {
    const pkg = { label: "temp paket", manifest: "Cargo.toml", required: false };
    const r = auditPackage(pkg, tempDir());
    expect(r.status).toBe("SKIP");
    expect(r.detail).toContain("manifest yok");
  });

  it("auditAll sonucu SADECE zorunlu paket FAIL'ine takılır (opsiyonel WARN engellemez)", () => {
    const log = [];
    const runAudit = (pkg) => {
      log.push(pkg.label);
      if (pkg.label === PACKAGES[0].label)
        return { label: pkg.label, status: "FAIL", detail: "derleme hatası" };
      return { label: pkg.label, status: "WARN", detail: "opsiyonel paket derlenemedi" };
    };
    const { results, ok } = auditAll({ runAudit, scan: noScan, root: tempDir() });
    expect(results.map((r) => r.status)).toEqual(["FAIL", "WARN", "WARN"]);
    expect(ok).toBe(false);
    // Kapsam: üç paket de (workspace + 2 standalone) denetim listesinde
    expect(log).toEqual(PACKAGES.map((p) => p.label));
  });

  it("auditAll: her şey PASS ve uyarı yoksa ok=true", () => {
    const runAudit = (pkg) => ({ label: pkg.label, status: "PASS", detail: "fake" });
    const { results, ok } = auditAll({ runAudit, scan: noScan, root: tempDir() });
    expect(results.every((r) => r.status === "PASS")).toBe(true);
    expect(ok).toBe(true);
  });

  it("statik tarama: write_all kullanıp Write import etmeyen test modülünü yakalar", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "broken.rs"),
      "#[cfg(test)]\nmod t {\n  #[test]\n  fn w() { let mut s = fake(); s.write_all(b\"x\").unwrap(); }\n}\n"
    );
    expect(suspiciousTraitUses(dir)).toEqual(["broken.rs"]);
  });

  it("statik tarama: std::io::{Read, Write} import eden test modülü temiz sayılır", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "fixed.rs"),
      "#[cfg(test)]\nmod t {\n  use std::io::{Read as _, Write as _};\n  #[test]\n  fn w() { s.write_all(b\"x\").unwrap(); s.flush().unwrap(); }\n}\n"
    );
    expect(suspiciousTraitUses(dir)).toEqual([]);
  });

  it("statik tarama: #[cfg(test)] içermeyen dosyalar kapsam dışıdır", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "plain.rs"), "fn f() { s.write_all(b\"x\").unwrap(); }\n");
    expect(suspiciousTraitUses(dir)).toEqual([]);
  });

  it("tail uzun çıktıyı son n karaktere kırpıp ellipsis koyar", () => {
    expect(tail("abc", 5)).toBe("abc");
    expect(tail("0123456789", 4)).toBe("…6789");
  });

  it("testBinaries cargo çıktısındaki Executable satırlarını sayar", () => {
    const out =
      "Executable unittests src\\lib.rs (target\\debug\\deps\\votex.exe)\nExecutable unittests src/main.rs (target/debug/deps/votex-abc.exe)\n";
    expect(testBinaries(out)).toBe(2);
  });
});
