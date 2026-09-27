#!/usr/bin/env node
/**
 * ci_prep_check.mjs — Rust test derleme denetimi (CI hazırlık)
 *
 * Neden var?
 *   CI faturalandırma kilidi sırasında `dta_bridge.rs` test modülünün
 *   derlenmediği fark edilemedi (eksik std::io import → 8 × E0599).
 *   `cargo test dta` yalnızca adı geçen testleri derler; votex-prob ve
 *   standalone crate'ler CI zincirinde hiç derlenmiyor. Bu denetim her
 *   Rust paketinin test profilini `--no-run` ile uçtan uca derleyerek
 *   bozuk/derlenmeyen test kodunu push'tan ÖNCE yakalar.
 *
 * Kapsam:
 *   1. Workspace (src-tauri + votex-prob)  — zorunlu (FAIL = denetim düşer)
 *   2. votex-wasm (standalone crate)       — opsiyonel (FAIL = WARN)
 *   3. votex-3d-visualizer (standalone)    — opsiyonel (FAIL = WARN)
 *
 * Kullanım:
 *   npm run ci:prep                        ← özet çıktı
 *   node scripts/ci_prep_check.mjs --json  ← CI/automation için JSON
 *
 * Not: Testlerin ÇALIŞTIRILMASI bu denetimin kapsamı dışındadır
 * (cargo test dta / test:rust / ci-local.js devam eder). Buradaki
 * sözleşme tek ve nettir: TÜM test kodu DERLENMELİ.
 */

import { execFileSync } from "child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { pathToFileURL } from "url";

const ROOT = join(import.meta.dirname, "..");

export const PACKAGES = [
  { label: "workspace (src-tauri + votex-prob)", manifest: "Cargo.toml", required: true },
  { label: "votex-wasm", manifest: "votex-wasm/Cargo.toml", required: false },
  { label: "votex-3d-visualizer", manifest: "votex-3d-visualizer/src-tauri/Cargo.toml", required: false },
];

export function tail(s, n) {
  s = String(s || "");
  return s.length > n ? "…" + s.slice(-n) : s;
}

/** cargo çıktısındaki "Executable ..." satırlarını sayar (test binary'leri). */
export function testBinaries(output) {
  return (String(output).match(/^Executable .*$/gm) || []).length;
}

/**
 * Statik tarama: test modülü olan kaynakta write_all/flush/read_exact/read_to_string
 * kullanımı var ama std::io::{Read, Write} import'u yoksa dosyayı raporlar.
 * Derleme hatası zaten cargo ile yakalanır; bu tarama, örn. trait'in yalnızca
 * baz feature'larda gerektiği sessiz senaryolar için ikinci katmandır.
 */
export function suspiciousTraitUses(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "target" || name.startsWith(".")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".rs")) {
        const src = readFileSync(p, "utf-8");
        if (!src.includes("#[cfg(test)]")) continue;
        // E0599 tam olarak metot çağrısında oluşur (stream.write_all(...)) —
        // bu yüzden önündeki '.' zorunludur (fn tanımlarını hariç tutar).
        const usesWrite = /\.write_all\(/m.test(src) || /\.flush\(/m.test(src);
        const usesRead = /\.read_exact\(/m.test(src) || /\.read_to_string\(/m.test(src);
        const importsWrite = /use\s+std::io::[^;]*Write/.test(src);
        const importsRead = /use\s+std::io::[^;]*Read/.test(src);
        if ((usesWrite && !importsWrite) || (usesRead && !importsRead)) {
          // Taranan dizine göreli yol — modül kökü dışındaki dizinlerde de doğru çalışır.
          hits.push(relative(dir, p).split("\\").join("/"));
        }
      }
    }
  };
  walk(dir);
  return hits;
}

/** Tek paketi derler. Dönen durum: PASS | FAIL | SKIP | WARN. */
export function auditPackage(pkg, root = ROOT) {
  const manifestPath = join(root, pkg.manifest);
  if (!existsSync(manifestPath)) {
    if (pkg.required) {
      return { label: pkg.label, status: "FAIL", detail: `zorunlu manifest yok: ${pkg.manifest}` };
    }
    return { label: pkg.label, status: "SKIP", detail: "manifest yok" };
  }
  const t0 = Date.now();
  try {
    const out = execFileSync("cargo", ["test", "--manifest-path", manifestPath, "--no-run"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 600_000,
    });
    return {
      label: pkg.label,
      status: "PASS",
      ms: Date.now() - t0,
      detail: `derlendi (${testBinaries(out)} test binary)`,
    };
  } catch (e) {
    const r = {
      label: pkg.label,
      status: pkg.required ? "FAIL" : "WARN",
      ms: Date.now() - t0,
      detail: tail(e.stderr || e.stdout || e.message, 800),
    };
    return r;
  }
}

export function auditAll({ root = ROOT, runAudit = auditPackage, scan = suspiciousTraitUses } = {}) {
  const results = PACKAGES.map((pkg) => runAudit(pkg, root));

  const scanRoots = ["src-tauri/src", "votex-prob/src"].filter((d) => existsSync(join(root, d)));
  const warnings = scanRoots.flatMap((d) =>
    scan(join(root, d)).map((rel) => `${d.split("\\").join("/")}/${rel}`)
  );

  const hardFailed = results.some((r) => r.status === "FAIL");
  const ok = !hardFailed && warnings.length === 0;
  return { results, warnings, ok };
}

function main() {
  const JSON_MODE = process.argv.includes("--json");
  const { results, warnings, ok } = auditAll();

  if (JSON_MODE) {
    console.log(JSON.stringify({ ok, warnings, results }, null, 2));
  } else {
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   RUST TEST DERLEME DENETİMİ (CI hazırlık)      ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");
    for (const r of results) {
      const icon = r.status === "PASS" ? "✅" : r.status === "SKIP" ? "⏭️ " : r.status === "WARN" ? "⚠️ " : "❌";
      console.log(`  ${icon} ${r.status.padEnd(4)}  ${r.label} (${((r.ms || 0) / 1000).toFixed(1)}s)`);
      if (r.status === "FAIL" || r.status === "WARN") console.log(`      ${r.detail}`);
    }
    if (warnings.length) {
      console.log("\n  ⚠️  Statik uyarı — test modülünde Write/Read kullanımı ama trait import'u yok:");
      for (const w of warnings) console.log(`      - ${w}`);
    }
    console.log(
      ok
        ? "\n✅ TÜM RUST PAKETLERİNİN TEST KODU DERLENİYOR — CI hazır.\n"
        : "\n❌ DENETİM BAŞARISIZ — yukarıdaki paketleri düzeltmeden push etmeyin.\n"
    );
  }
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
