#!/usr/bin/env node
/**
 * release.mjs — Votex sürüm artırma + Windows setup üretimini TEK komuta indirir.
 *
 * Kullanım:
 *   npm run release                                  ← patch +1, tek setup üretimi
 *   npm run release -- minor -m "not 1" -m "not 2"   ← minor + sürüm notları
 *   npm run release -- 0.5.0 --title "Özel başlık"   ← doğrudan sürüm
 *   npm run release -- patch --skip-tests --dry-run  ← yalnız senkronizasyon provası
 *
 * Adımlar (kural: her işlemde sürüm + setup):
 *   1. Sürümü belirle (patch|minor|major|x.y.z)
 *   2. 7 dosyada senkronize et: package.json, package-lock.json (yenilenir),
 *      src-tauri/Cargo.toml (+ kök Cargo.lock yenilenir), src-tauri/tauri.conf.json
 *      (sürüm + pencere başlığı), modules/dft_packager/DFT_Suite.iss (sürüm + çıktı adı),
 *      modules/dft_packager/build_single_setup.py, CHANGELOG.md (yeni bölüm)
 *   3. Doğrula: npm run test:js + git diff --check
 *   4. Üret: npm run build:installer → python modules/dft_packager/build_single_setup.py --skip-tauri
 *   5. Hash tazeliğini doğrula (votex.exe ↔ staging/VOTEX/Votex.exe) ve özeti bas
 */

import { execSync } from "child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "path";
import { pathToFileURL } from "node:url";

const ROOT = join(import.meta.dirname, "..");

/* ── Saf dönüştürücüler (birim testlenirler) ─────────────── */

/** Semver artırımı: "patch" | "minor" | "major" | doğrudan "x.y.z". */
export function bumpVersion(current, mode = "patch") {
  if (/^\d+\.\d+\.\d+$/.test(mode)) return mode;
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`Geçersiz sürüm: ${current}`);
  const [a, b, c] = m.slice(1).map(Number);
  if (mode === "major") return `${a + 1}.0.0`;
  if (mode === "minor") return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

/** Cargo.toml — yalnız [package] bölümündeki sürümü değiştirir. */
export function syncCargoToml(content, version) {
  return content.replace(
    /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/,
    `$1${version}$3`
  );
}

/** tauri.conf.json — sürüm + pencere başlığı. */
export function syncTauriConf(content, version) {
  return content
    .replace(/("version":\s*")[^"]+(")/, `$1${version}$2`)
    .replace(
      /("title":\s*"Votex )[^—]*( — Magnetic Anomaly Analysis")/,
      `$1${version}$2`
    );
}

/** DFT_Suite.iss — MyAppVersion + OutputBaseFilename. */
export function syncIss(content, version) {
  return content
    .replace(/(#define MyAppVersion ")[^"]+(")/, `$1${version}$2`)
    .replace(/(OutputBaseFilename=DFT_Suite_Setup_)[\d.]+/, `$1${version}`);
}

/** VotexArtemis.iss — MyAppVersion + OutputBaseFilename (ayrı program paketi). */
export function syncArtemisIss(content, version) {
  return content
    .replace(/(#define MyAppVersion ")[^"]+(")/, `$1${version}$2`)
    .replace(/(OutputBaseFilename=VotexArtemis_Setup_)[\d.]+/, `$1${version}`);
}

/** build_single_setup.py — PACKAGE_VERSION. */
export function syncPackagerPy(content, version) {
  return content.replace(/(PACKAGE_VERSION = ")[^"]+(")/, `$1${version}$2`);
}

/** CHANGELOG'ın başına eklenecek yeni bölüm. */
export function changelogSection({ version, dateText, title, bullets, setupBuilt }) {
  const list = [];
  for (const b of bullets.length ? bullets : ["Bakım sürümü."]) list.push(`- ${b}`);
  if (setupBuilt) list.push(`- VOTEX ${version} Windows setup üretildi.`);
  return `## ${version} — ${dateText}\n\n### ${title}\n\n${list.join("\n")}\n\n`;
}

/* ── Yardımcılar ─────────────────────────────────────────── */

function run(label, cmd) {
  process.stdout.write(`\n🔵 ${label}...`);
  const t0 = Date.now();
  execSync(cmd, { cwd: ROOT, stdio: "inherit", timeout: 600_000 });
  process.stdout.write(` ✅ (${Date.now() - t0}ms)\n`);
}

function edit(rel, transform, dryRun) {
  const abs = join(ROOT, rel);
  const before = readFileSync(abs, "utf-8");
  const after = transform(before);
  if (after === before) {
    throw new Error(`${rel}: sürüm değişmedi — desen eşleşmedi mi?`);
  }
  if (!dryRun) writeFileSync(abs, after);
  process.stdout.write(`  📝 ${rel}\n`);
}

function sha256(rel) {
  return createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function printHelp() {
  console.log(
    "Kullanım: node scripts/release.mjs [patch|minor|major|x.y.z] [-m \"not\"]... [--title \"başlık\"] [--skip-tests] [--skip-build] [--dry-run]"
  );
}

/* ── CLI ─────────────────────────────────────────────────── */

function main() {
  const argv = process.argv.slice(2);
  const bullets = [];
  let title = "Sürüm güncellemeleri";
  let mode = "patch";
  let skipTests = false;
  let skipBuild = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-m" || a === "--message") bullets.push(argv[++i]);
    else if (a === "--title") title = argv[++i];
    else if (a === "--skip-tests") skipTests = true;
    else if (a === "--skip-build") skipBuild = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "-h" || a === "--help") return printHelp();
    else if (/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(a)) mode = a;
    else {
      console.error(`❌ Bilinmeyen argüman: ${a}`);
      printHelp();
      process.exit(1);
    }
  }

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
  const current = pkg.version;
  const version = bumpVersion(current, mode);
  const dateText = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());

  console.log("╔══════════════════════════════════════════════════╗");
  console.log(`║  VOTEX RELEASE — ${current} → ${version}${" ".repeat(Math.max(0, 27 - current.length - version.length))}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  // 1–2. Senkronizasyon
  process.stdout.write(`\n📝 Sürüm senkronizasyonu (${dryRun ? "dry-run" : "yazılıyor"}):\n`);
  edit("package.json", (c) => c.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`), dryRun);
  edit("src-tauri/Cargo.toml", (c) => syncCargoToml(c, version), dryRun);
  edit("src-tauri/tauri.conf.json", (c) => syncTauriConf(c, version), dryRun);
  edit("modules/dft_packager/DFT_Suite.iss", (c) => syncIss(c, version), dryRun);
  edit("modules/dft_packager/VotexArtemis.iss", (c) => syncArtemisIss(c, version), dryRun);
  edit("modules/dft_packager/build_single_setup.py", (c) => syncPackagerPy(c, version), dryRun);
  edit(
    "CHANGELOG.md",
    (c) =>
      changelogSection({ version, dateText, title, bullets, setupBuilt: !skipBuild && !dryRun }) + c,
    dryRun
  );

  if (dryRun) {
    console.log("\n✅ dry-run tamam — dosya yazılmadı, komut çalıştırılmadı.");
    return;
  }

  run("package-lock yenileme", "npm install --package-lock-only --ignore-scripts");
  run("Cargo.lock yenileme (cargo check)", "cargo check --manifest-path src-tauri/Cargo.toml");

  // 3. Doğrulama
  if (!skipTests) {
    run("JS Testleri (vitest)", "npm run test:js");
    run("git diff --check", "git diff --check");
  }

  // 4. Üretim
  if (!skipBuild) {
    run("NSIS Installer (tauri build)", "npm run build:installer");
    run(
      "Birleşik Setup (build_single_setup.py --skip-tauri)",
      "python modules/dft_packager/build_single_setup.py --skip-tauri"
    );
  }

  // 5. Hash doğrulama + özet
  const exe = "target/release/votex.exe";
  const staged = "modules/dft_packager/staging/VOTEX/Votex.exe";
  if (existsSync(join(ROOT, exe)) && existsSync(join(ROOT, staged))) {
    const a = sha256(exe);
    const b = sha256(staged);
    console.log(`\n🔑 votex.exe hash:      ${a.slice(0, 16)}…`);
    console.log(`🔑 staging Votex.exe:  ${b.slice(0, 16)}…`);
    console.log(a === b ? "✅ Hash'ler birebir aynı — paket taze derleme içeriyor." : "❌ HASH UYUŞMAZLIĞI — paket bayat olabilir!");
    if (a !== b) process.exit(1);
  }

  const artifacts = [
    `KURULUM_PAKETLERI/Votex_${version}_Kurulum.exe`,
    `modules/dft_packager/dist/DFT_Suite_Setup_${version}.exe`,
    `target/release/bundle/nsis/Votex_${version}_x64-setup.exe`,
    `KURULUM_PAKETLERI/VotexArtemis_${version}_Kurulum.exe`,
  ];
  console.log("\n📦 Üretilen paketler:");
  for (const rel of artifacts) {
    const abs = join(ROOT, rel);
    console.log(existsSync(abs) ? `  ✅ ${mb(statSync(abs).size).padStart(9)}  ${rel}` : `  ⚠️  bulunamadı: ${rel}`);
  }
  console.log(`\n🎉 VOTEX ${version} TAMAM — kullanıcıya verilecek: KURULUM_PAKETLERI/Votex_${version}_Kurulum.exe`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
