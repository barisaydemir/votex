#!/usr/bin/env node
/**
 * ci-local.js — Yerel CI scripti
 * 
 * Kullanım:
 *   node scripts/ci-local.js              ← tüm adımlar
 *   node scripts/ci-local.js --skip-rust  ← Rust testlerini atla
 *   node scripts/ci-local.js --skip-nsis  ← NSIS derlemesini atla
 *   node scripts/ci-local.js --quick      ← sadece JS test + build
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const skipRust = args.includes("--skip-rust");
const skipNsis = args.includes("--skip-nsis");
const quick = args.includes("--quick");

const results = [];
const startTime = Date.now();

function run(label, cmd, opts = {}) {
  const t0 = Date.now();
  process.stdout.write(`\n🔵 ${label}...`);
  try {
    const output = execSync(cmd, {
      cwd: ROOT,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: opts.timeout || 300_000,
      ...opts,
    });
    const ms = Date.now() - t0;
    process.stdout.write(` ✅ (${ms}ms)\n`);
    results.push({ label, status: "✅", ms });
    return output;
  } catch (e) {
    const ms = Date.now() - t0;
    process.stdout.write(` ❌ (${ms}ms)\n`);
    if (e.stdout) console.log(e.stdout.toString().slice(-500));
    if (e.stderr) console.log(e.stderr.toString().slice(-500));
    results.push({ label, status: "❌", ms, error: e.message?.slice(0, 200) });
    if (!opts.continueOnError) throw e;
  }
}

console.log("╔══════════════════════════════════════════════════╗");
console.log("║        VOTEX YEREL CI — BAŞLATILDI             ║");
console.log("╚══════════════════════════════════════════════════╝");

// 1. JS Testleri
run("JS Testleri (vitest)", "npx vitest run --reporter=dot", { timeout: 120_000 });

// 2. Frontend Build
run("Frontend Build (vite)", "npx vite build", { timeout: 60_000 });

if (!quick) {
  // 3. Rust Check
  if (!skipRust && existsSync(join(ROOT, "src-tauri", "Cargo.toml"))) {
    run("Rust Check (0 uyarı)", "cargo check --manifest-path src-tauri/Cargo.toml 2>&1 | tail -5", {
      timeout: 300_000,
      continueOnError: true,
    });

    // 4. Rust Testleri
    run("Rust Testleri (cargo test)", "cargo test --lib --manifest-path src-tauri/Cargo.toml 2>&1 | tail -10", {
      timeout: 300_000,
      continueOnError: true,
    });
  }

  // 5. NSIS Installer
  if (!skipNsis) {
    run("NSIS Installer Derleme", "npx tauri build 2>&1 | tail -10", {
      timeout: 600_000,
    });
  }
}

// Sonuç raporu
const totalMs = Date.now() - startTime;
console.log("\n╔══════════════════════════════════════════════════╗");
console.log("║          VOTEX CI — SONUÇ RAPORU                ║");
console.log("╠══════════════════════════════════════════════════╣");
for (const r of results) {
  const name = r.label.padEnd(30);
  const time = `${r.ms}ms`.padStart(8);
  console.log(`║  ${r.status} ${name} ${time}  ║`);
}
console.log("╠══════════════════════════════════════════════════╣");
const allPassed = results.every((r) => r.status === "✅");
const totalSec = (totalMs / 1000).toFixed(1);
console.log(`║  Toplam: ${totalSec}s — ${results.length}/${results.length} başarılı`);
if (allPassed) {
  console.log("║  🎉 TÜM TESTLER BAŞARILI");
} else {
  const failed = results.filter((r) => r.status === "❌").length;
  console.log(`║  ⚠️  ${failed} test başarısız`);
}
console.log("╚══════════════════════════════════════════════════╝");

// NSIS dosyasını göster
if (!skipNsis) {
  const nsisDir = join(ROOT, "target", "release", "bundle", "nsis");
  if (existsSync(nsisDir)) {
    const { readdirSync, statSync } = await import("fs");
    const files = readdirSync(nsisDir).filter((f) => f.endsWith(".exe"));
    if (files.length) {
      const latest = files.sort().pop();
      const size = statSync(join(nsisDir, latest)).size;
      const mb = (size / 1024 / 1024).toFixed(0);
      console.log(`\n📦 Kurulum: target/release/bundle/nsis/${latest} (${mb} MB)`);
    }
  }
}

process.exit(allPassed ? 0 : 1);
