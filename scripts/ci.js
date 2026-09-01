#!/usr/bin/env node
/**
 * Votex CI Pipeline — Tüm testleri ve build'leri tek komutta çalıştırır.
 *
 * Kullanım:
 *   node scripts/ci.js                    # Tüm aşamalar
 *   node scripts/ci.js --skip-installer   # Installer atla
 *   node scripts/ci.js --skip-rust        # Rust test/check atla
 *   node scripts/ci.js --skip-build       # Build atla
 *   node scripts/ci.js --only js          # Sadece JS testleri
 *   node scripts/ci.js --only rust        # Sadece Rust test + check
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Args ──
const args = process.argv.slice(2);
const flags = {
  skipBuild: args.includes('--skip-build'),
  skipInstaller: args.includes('--skip-installer'),
  skipRust: args.includes('--skip-rust'),
  only: args.includes('--only') ? args[args.indexOf('--only') + 1] : null,
};

const ROOT = join(import.meta.dirname, '..');
const TAURI_DIR = join(ROOT, 'src-tauri');

// ── Helpers ──
const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[1;33m',
  cyan: '\x1b[0;36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function hdr(n, msg) {
  console.log(`\n${C.cyan}═══ ADIM ${n} ═══${C.reset}`);
  console.log(`  ${C.bold}${msg}${C.reset}`);
}
function ok(msg) { console.log(`  ${C.green}✅ ${msg}${C.reset}`); }
function fail(msg) { console.log(`  ${C.red}❌ ${msg}${C.reset}`); }
function skip(msg) { console.log(`  ${C.yellow}⏭️  ${msg}${C.reset}`); }

function run(cmd, cwd) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, out: stripAnsi(out), code: 0 };
  } catch (e) {
    return { ok: false, out: stripAnsi((e.stdout || '') + (e.stderr || '')), code: e.status || 1 };
  }
}

/** ANSI escape kodlarını temizle */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ── Pipeline ──
const results = [];
const totalStart = Date.now();

function record(name, status, detail) {
  results.push({ name, status, detail });
}

// ══════════════════════════════════════════════════════════════
// ADIM 1: JS Testleri
// ══════════════════════════════════════════════════════════════
if (!flags.only || flags.only === 'js') {
  hdr(1, 'JS Testleri (vitest)');
  const t0 = Date.now();
  const r = run('npm run test:js', ROOT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.ok) {
    const m = r.out.match(/^\s*Tests\s+(\d+)\s+passed/m);
    ok(`${m ? m[1] : '??'} test geçti (${elapsed}s)`);
    record('JS Test', 'PASS', `${m ? m[1] : '??'} tests`);
  } else {
    fail(`JS testleri başarısız (${elapsed}s)`);
    console.log(C.dim + r.out.split('\n').slice(-5).join('\n') + C.reset);
    record('JS Test', 'FAIL', `exit ${r.code}`);
  }
}

// ══════════════════════════════════════════════════════════════
// ADIM 2: Rust Testleri
// ══════════════════════════════════════════════════════════════
if ((!flags.only || flags.only === 'rust') && !flags.skipRust) {
  hdr(2, 'Rust Testleri (cargo test --lib)');
  const t0 = Date.now();
  const r = run('cargo test --lib', TAURI_DIR);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.ok) {
    const m = r.out.match(/test result: ok\.\s+(\d+)\s+passed/);
    ok(`${m ? m[1] : '??'} Rust test geçti (${elapsed}s)`);
    record('Rust Test', 'PASS', `${m ? m[1] : '??'} tests`);
  } else {
    fail(`Rust testleri başarısız (${elapsed}s)`);
    console.log(C.dim + r.out.split('\n').filter(l => l.includes('FAILED')).slice(0, 5).join('\n') + C.reset);
    record('Rust Test', 'FAIL', `exit ${r.code}`);
  }
} else if (!flags.only || flags.only === 'rust') {
  hdr(2, 'Rust Testleri — ATLANDI');
  skip('--skip-rust');
  record('Rust Test', 'SKIP', 'parameter');
}

// ══════════════════════════════════════════════════════════════
// ADIM 3: Rust Check
// ══════════════════════════════════════════════════════════════
if ((!flags.only || flags.only === 'rust') && !flags.skipRust) {
  hdr(3, 'Rust Check (cargo check)');
  const t0 = Date.now();
  const r = run('cargo check', TAURI_DIR);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.ok) {
    const warns = (r.out.match(/warning:/g) || []).length;
    ok(`0 hata, ${warns} uyarı (${elapsed}s)`);
    record('Rust Check', 'PASS', `${warns} warnings`);
  } else {
    fail(`Cargo check başarısız (${elapsed}s)`);
    record('Rust Check', 'FAIL', `exit ${r.code}`);
  }
} else {
  hdr(3, 'Rust Check — ATLANDI');
  skip('parameter');
  record('Rust Check', 'SKIP', 'parameter');
}

// ══════════════════════════════════════════════════════════════
// ADIM 4: Frontend Build
// ══════════════════════════════════════════════════════════════
if ((!flags.only || flags.only === 'build') && !flags.skipBuild) {
  hdr(4, 'Frontend Build (vite build)');
  const t0 = Date.now();
  const r = run('npm run build', ROOT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.ok) {
    ok(`Build başarılı (${elapsed}s)`);
    record('Frontend Build', 'PASS', `${elapsed}s`);
  } else {
    fail(`Build başarısız (${elapsed}s)`);
    record('Frontend Build', 'FAIL', `exit ${r.code}`);
  }
} else if (!flags.only) {
  hdr(4, 'Frontend Build — ATLANDI');
  skip('--skip-build');
  record('Frontend Build', 'SKIP', 'parameter');
}

// ══════════════════════════════════════════════════════════════
// ADIM 5: NSIS Installer
// ══════════════════════════════════════════════════════════════
if ((!flags.only || flags.only === 'installer') && !flags.skipBuild && !flags.skipInstaller) {
  hdr(5, 'NSIS Installer (tauri build)');
  const t0 = Date.now();
  const r = run('npm run build:installer', ROOT);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (r.ok) {
    const nsisDir = join(ROOT, 'target', 'release', 'bundle', 'nsis');
    if (existsSync(nsisDir)) {
      const files = readdirSync(nsisDir).filter(f => f.endsWith('.exe')).sort().reverse();
      if (files[0]) {
        const stat = require('node:fs').statSync(join(nsisDir, files[0]));
        const mb = Math.round(stat.size / 1024 / 1024);
        ok(`${files[0]} (${mb} MB, ${elapsed}s)`);
        record('NSIS Installer', 'PASS', `${files[0]} (${mb}MB)`);
      } else {
        ok(`Installer derlendi (${elapsed}s)`);
        record('NSIS Installer', 'PASS', `${elapsed}s`);
      }
    } else {
      ok(`Installer derlendi (${elapsed}s)`);
      record('NSIS Installer', 'PASS', `${elapsed}s`);
    }
  } else {
    fail(`Installer başarısız (${elapsed}s)`);
    record('NSIS Installer', 'FAIL', `exit ${r.code}`);
  }
} else if (!flags.only) {
  hdr(5, 'NSIS Installer — ATLANDI');
  skip('--skip-installer');
  record('NSIS Installer', 'SKIP', 'parameter');
}

// ══════════════════════════════════════════════════════════════
// ÖZET RAPOR
// ══════════════════════════════════════════════════════════════
const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status === 'FAIL').length;
const skipCount = results.filter(r => r.status === 'SKIP').length;

console.log(`\n${C.cyan}╔══════════════════════════════════════════════════╗${C.reset}`);
console.log(`${C.cyan}║           CI PIPELINE ÖZET RAPORU               ║${C.reset}`);
console.log(`${C.cyan}╠══════════════════════════════════════════════════╣${C.reset}`);

for (const r of results) {
  const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️ ';
  const col = r.status === 'PASS' ? C.green : r.status === 'FAIL' ? C.red : C.yellow;
  console.log(`${col}║  ${icon} ${r.name.padEnd(18)} ${r.detail.padEnd(20)} ║${C.reset}`);
}

console.log(`${C.cyan}╠══════════════════════════════════════════════════╣${C.reset}`);
console.log(`║  Toplam Süre: ${totalElapsed}s`);

if (failCount === 0) {
  console.log(`${C.green}║  🎉 TÜM TESTLER BAŞARILI (${passCount}/${passCount + skipCount})                ║${C.reset}`);
} else {
  console.log(`${C.red}║  ⚠️  ${failCount} TEST BAŞARISIZ                     ║${C.reset}`);
}

console.log(`${C.cyan}╚══════════════════════════════════════════════════╝${C.reset}`);

process.exit(failCount === 0 ? 0 : 1);
