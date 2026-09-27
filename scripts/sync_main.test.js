import { describe, it, expect } from "vitest";
import {
  parseCherry,
  decidePreAlign,
  mergeRetryDecision,
  needsSync,
  prBody,
  reportLine,
} from "./sync_main.mjs";

describe("sync_main saf yardımcıları", () => {
  it("parseCherry: '-' twin, '+' gerçek yeni commit sayar", () => {
    const out = "- abc123 fix: eski (main'de var)\n+ def456 feat: yeni iş\n+ ghi789 fix: başka iş\n\n";
    expect(parseCherry(out)).toEqual({ twins: 1, fresh: 2 });
  });

  it("parseCherry: boş çıktı → 0/0", () => {
    expect(parseCherry("")).toEqual({ twins: 0, fresh: 0 });
    expect(parseCherry(null)).toEqual({ twins: 0, fresh: 0 });
  });

  it("decidePreAlign: twin commit varsa rebase", () => {
    expect(decidePreAlign({ twins: 2, fresh: 1, mainMoved: false })).toBe("rebase");
  });

  it("decidePreAlign: main hareket ettiyse rebase (twin olsa da olmasa da)", () => {
    expect(decidePreAlign({ twins: 0, fresh: 1, mainMoved: true })).toBe("rebase");
  });

  it("decidePreAlign: twin yok + main hareketsiz → skip", () => {
    expect(decidePreAlign({ twins: 0, fresh: 3, mainMoved: false })).toBe("skip");
  });

  it("mergeRetryDecision: rebase-merge ikiz çakışması → retry", () => {
    expect(mergeRetryDecision(" Pull request is not mergeable: the merge commit cannot be cleanly created.")).toBe("retry");
    expect(mergeRetryDecision("Merge conflict in file.txt")).toBe("retry");
  });

  it("mergeRetryDecision: başka hata → abort", () => {
    expect(mergeRetryDecision("network error")).toBe("abort");
    expect(mergeRetryDecision("")).toBe("abort");
  });

  it("needsSync: main'e göre gerçek commit yoksa senkron gerekmez", () => {
    expect(needsSync({ aheadAfterAlign: 0 })).toBe(false);
    expect(needsSync({ aheadAfterAlign: 1 })).toBe(true);
  });

  it("prBody: commit listesi + dal bilgisi + footer içerir", () => {
    const body = prBody({ commits: ["feat: a", "fix: b"], head: "cursor/x", base: "main" });
    expect(body).toContain("- feat: a");
    expect(body).toContain("- fix: b");
    expect(body).toContain("`cursor/x`");
    expect(body).toContain("`main`");
    expect(body).toContain("Generated with Codebuff");
  });

  it("reportLine: tamamlanmış tur özeti doğru biçimlenir", () => {
    const line = reportLine({
      pr: 3,
      mergeCommit: "c2e3effcedfb7bdd353d5749922bf1ed9db5228f",
      branch: "cursor/x",
      mainTip: "c2e3effcedfb7bdd353d5749922bf1ed9db5228f",
      aheadAfter: 0,
    });
    expect(line).toContain("PR #3");
    expect(line).toContain("merge: c2e3eff");
    expect(line).toContain("dal: cursor/x");
    expect(line).toContain("dal = main ✓");
  });

  it("reportLine: senkron-dışı durum ileride sayısını gösterir", () => {
    const line = reportLine({ pr: null, mergeCommit: null, branch: "cursor/x", mainTip: "abc1234", aheadAfter: 2 });
    expect(line).toContain("PR —");
    expect(line).toContain("2 ileride");
  });
});
