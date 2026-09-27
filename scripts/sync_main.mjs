#!/usr/bin/env node
/**
 * sync_main.mjs — korumalı main senkron döngüsü (tek komut)
 *
 * Akış (bu oturumda elle prove edilen turun otomasyonu):
 *   0. Ön kontrol   — temiz tree, main üzerinde değil, origin ile eşit
 *   1. Pre-align    — origin/main üzerine rebase: twin commit'ler (önceki
 *                     rebase-merge'in yeniden yazdığı ikizler) düşer, main
 *                     harekettiyse içerir → push --force-with-lease
 *   2. PR           — açık PR varsa kullan, yoksa son commit başlığıyla aç
 *   3. Merge        — gh pr merge --rebase; "cannot be cleanly created"
 *                     hatasında yeniden hizala ve BİR kez daha dene
 *   4. Post-align   — dalı origin/main'e rebase (yeni twin'leri at), main'i
 *                     lokalde fast-forward et, feature dalına geri dön
 *   5. Rapor        — PR, merge commit, dal/main durumu
 *
 * Kullanım:
 *   npm run sync_main                    ← mevcut dalı main'e senkronla
 *   npm run sync_main -- --branch <ad>   ← dalı açıkça seç
 *   npm run sync_main -- --dry-run       ← planı göster, hiçbir şey yapma
 *
 * Not: main branch protection gereği PR'sız push GitHub tarafından
 * reddedilir (admin dahil); rebase merge main'i lineer tutar.
 */

import { execFileSync } from "child_process";
import { pathToFileURL } from "url";

const ROOT = process.cwd();

// ── Saf yardımcılar (birim testleri: scripts/sync_main.test.js) ─────────

/** `git cherry` çıktısını sayar: '-' = main'de patch-eşdeğeri var (twin), '+' = gerçek yeni commit. */
export function parseCherry(output) {
  const lines = String(output || "")
    .split("\n")
    .filter((l) => /^[+-]/.test(l.trim()));
  return {
    twins: lines.filter((l) => l.startsWith("-")).length,
    fresh: lines.filter((l) => l.startsWith("+")).length,
  };
}

/** Pre-align kararı: twin commit varsa veya main hareket ettiyse rebase gerekli. */
export function decidePreAlign({ twins, mainMoved }) {
  return twins > 0 || mainMoved ? "rebase" : "skip";
}

/** Merge hatası tekrarlanabilir mi? (rebase-merge ikiz çakışması → hizala + retry) */
export function mergeRetryDecision(errorText) {
  const t = String(errorText || "");
  return /not mergeable|cannot be cleanly created|Merge conflict/i.test(t) ? "retry" : "abort";
}

/** Yapılacak iş var mı? (pre-align sonrası main'e göre gerçek yeni commit sayısı) */
export function needsSync({ aheadAfterAlign }) {
  return aheadAfterAlign > 0;
}

/** PR gövdesi üretir. */
export function prBody({ commits, head, base }) {
  const list = commits.map((c) => `- ${c}`).join("\n");
  return (
    `## Senkron: \`${head}\` → \`${base}\`\n\n` +
    `${list || "- (commit notu yok)"}\n\n` +
    `Korumalı akış: PR zorunlu (0 onay) + rebase merge → main lineer kalır.\n\n` +
    `🤖 Generated with Codebuff`
  );
}

/** Rapor satırı biçimlendirir. */
export function reportLine({ pr, mergeCommit, branch, mainTip, aheadAfter }) {
  const parts = [];
  parts.push(pr ? `PR #${pr}` : "PR —");
  parts.push(mergeCommit ? `merge: ${mergeCommit.slice(0, 7)}` : "merge: —");
  parts.push(`dal: ${branch}`);
  parts.push(`main: ${String(mainTip || "").slice(0, 7)}`);
  parts.push(aheadAfter === 0 ? "dal = main ✓" : `dal main'e göre ${aheadAfter} ileride`);
  return parts.join(" · ");
}

// ── Komut yardımcıları ──────────────────────────────────────────────────

function run(cmd, args, { capture = true } = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function sh(label, cmd, args) {
  process.stdout.write(`🔵 ${label}...`);
  try {
    const out = run(cmd, args);
    process.stdout.write(" ✅\n");
    return { ok: true, out };
  } catch (e) {
    process.stdout.write(" ❌\n");
    return { ok: false, err: String((e.stderr || "") + (e.stdout || "") + e.message) };
  }
}

function die(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function rev(ref) {
  return run("git", ["rev-parse", ref]).trim();
}

function count(range) {
  return parseInt(run("git", ["rev-list", "--count", range]).trim(), 10) || 0;
}

// ── Ana akış ────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const branchArgIdx = argv.indexOf("--branch");
  const branch = branchArgIdx >= 0 ? argv[branchArgIdx + 1] : run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   SYNC_MAIN — korumalı main senkron döngüsü     ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // 0. Ön kontroller
  const porcelain = run("git", ["status", "--porcelain"]).trim();
  if (porcelain) die(`working tree temiz değil — önce commit/stash yapın:\n${porcelain}`);
  if (branch === "main") die("feature dalında olmalısınız (main senkronlanacak dal, kaynak olamaz). --branch <ad> kullanın.");

  console.log(`\nDal: ${branch}`);
  sh("fetch origin --prune", "git", ["fetch", "origin", "--prune"]);

  const originBranch = `origin/${branch}`;
  const aheadOwn = count(`${originBranch}..${branch}`);
  const behindOwn = count(`${branch}..${originBranch}`);
  if (behindOwn > 0) die(`${originBranch} ileride (${behindOwn} commit) — önce pull/rebase, sonra yeniden deneyin.`);
  if (aheadOwn > 0) sh("push (yerel commit'ler)", "git", ["push", "origin", branch]);

  // 1. Pre-align
  const cherry = parseCherry(run("git", ["cherry", "origin/main", branch]));
  const mainMoved = count(`${branch}..origin/main`) > 0;
  const preAlign = decidePreAlign({ ...cherry, mainMoved });
  console.log(`\nPre-align: ${preAlign} (twin: ${cherry.twins}, main hareketi: ${mainMoved ? "var" : "yok"})`);
  if (dryRun) {
    console.log("\n✅ dry-run — plan burada bitti, hiçbir şey yapılmadı.");
    return;
  }
  if (preAlign === "rebase") {
    const r = sh("rebase origin/main", "git", ["rebase", "origin/main"]);
    if (!r.ok) die(`rebase çakışması — elle çözün:\n${r.err}`);
    if (rev("HEAD") !== rev(originBranch)) {
      sh("push --force-with-lease", "git", ["push", "--force-with-lease", "origin", branch]);
    }
  }

  // 2. Yapılacak iş var mı?
  const aheadAfterAlign = count(`origin/main..${branch}`);
  if (!needsSync({ aheadAfterAlign })) {
    console.log("\n✅ Dal main ile senkron — açılacak PR yok. Rapor:");
    console.log("   " + reportLine({ pr: null, mergeCommit: null, branch, mainTip: rev("origin/main"), aheadAfter: 0 }));
    return;
  }

  // 3. PR aç / yeniden kullan
  const openPr = run("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", ".[0].number"]).trim();
  let pr = openPr ? parseInt(openPr, 10) : null;
  if (pr) {
    console.log(`\nAçık PR bulundu: #${pr} — yeniden kullanılıyor`);
  } else {
    const title = run("git", ["log", "-1", "--pretty=%s"]).trim();
    const commits = run("git", ["log", "--pretty=%s", `origin/main..${branch}`]).trim().split("\n").reverse();
    const body = prBody({ commits, head: branch, base: "main" });
    const r = sh(`PR oluştur (${title})`, "gh", [
      "pr", "create", "--base", "main", "--head", branch, "--title", title, "--body", body,
    ]);
    if (!r.ok) die(`PR açılamadı:\n${r.err}`);
    const urlLine = r.out.trim().split("\n").pop();
    pr = parseInt((urlLine.match(/\/pull\/(\d+)/) || [])[1], 10);
    console.log(`PR #${pr} açıldı: ${urlLine}`);
  }

  // 4. Merge (retry'li)
  let merged = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = sh(`merge --rebase (deneme ${attempt})`, "gh", ["pr", "merge", String(pr), "--rebase"]);
    if (r.ok) {
      merged = true;
      break;
    }
    if (attempt === 1 && mergeRetryDecision(r.err) === "retry") {
      console.log("   ↻ merge reddedildi (ikiz commit çakışması) — dal yeniden hizalanıyor...");
      sh("fetch", "git", ["fetch", "origin", "--prune"]);
      const rb = sh("rebase origin/main", "git", ["rebase", "origin/main"]);
      if (!rb.ok) die(`rebase çakışması:\n${rb.err}`);
      sh("push --force-with-lease", "git", ["push", "--force-with-lease", "origin", branch]);
      continue;
    }
    die(`PR merge edilemedi:\n${r.err}`);
  }

  // 5. Post-align: dalı tazele, main'i ff et, geri dön
  sh("fetch", "git", ["fetch", "origin", "--prune"]);
  sh(`checkout main`, "git", ["checkout", "main"]);
  sh("main fast-forward", "git", ["merge", "--ff-only", "origin/main"]);
  const mainTip = rev("main");
  sh(`checkout ${branch}`, "git", ["checkout", branch]);
  if (count(`${branch}..origin/main`) > 0 || parseCherry(run("git", ["cherry", "origin/main", branch])).twins > 0) {
    const rb = sh("dal yeniden hizalama (rebase)", "git", ["rebase", "origin/main"]);
    if (rb.ok && rev("HEAD") !== rev(originBranch)) {
      sh("push --force-with-lease", "git", ["push", "--force-with-lease", "origin", branch]);
    }
  }

  // 6. Rapor
  const meta = JSON.parse(run("gh", ["pr", "view", String(pr), "--json", "url,mergeCommit", "--jq", "."]) || "{}");
  console.log("\n────────────────────────────────────────────────────");
  console.log("✅ SYNC_MAIN TAMAM");
  console.log("   " + reportLine({ pr, mergeCommit: meta.mergeCommit?.oid, branch, mainTip, aheadAfter: count(`origin/main..${branch}`) }));
  if (meta.url) console.log(`   ${meta.url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
