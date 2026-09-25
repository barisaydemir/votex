import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function findPython() {
  for (const cand of ["python", "python3"]) {
    const r = spawnSync(cand, ["--version"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return cand;
  }
  return null;
}

const PY = findPython();
const SCRIPT = resolve("modules/dft_packager/build_single_setup.py");
// Windows konsol kod sayfası Türkçe çıktıyı boğmasın
const ENV = { ...process.env, PYTHONIOENCODING: "utf-8" };

const GOOD = `<!doctype html>
<html><body>
<main class="layout">
  <section id="panel-ops">
    <div id="ops-core-a">
      <details class="tree-section"><summary>TOPRAK</summary>
        <div class="tree-body"><p id="soil-hint">ipucu</p></div>
      </details>
    </div>
  </section>
  <section id="panel-stage"><div class="view-tabs"><span>s</span></div></section>
  <section id="panel-intel"><button type="button">b</button></section>
</main>
</body></html>`;

function check(html) {
  const dir = mkdtempSync(join(tmpdir(), "votex-ui-health-"));
  const file = join(dir, "index.html");
  writeFileSync(file, html, "utf8");
  const r = spawnSync(PY, [SCRIPT, "--check-ui", file], {
    encoding: "utf8",
    env: ENV,
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe.skipIf(!PY)(
  "build_single_setup.py — zorunlu arayüz sağlık kontrolü",
  () => {
    it("gerçek index.html geçerli (regresyon muhafızı)", () => {
      const r = spawnSync(PY, [SCRIPT, "--check-ui", resolve("index.html")], {
        encoding: "utf8",
        env: ENV,
      });
      expect(r.status).toBe(0);
    });

    it("sağlıklı HTML geçer", () => {
      const r = check(GOOD);
      expect(r.status).toBe(0);
    });

    it("kapanmamış details/div (arayüz yutma hatası) yakalanır", () => {
      const bad = GOOD.replace(
        '<div class="tree-body"><p id="soil-hint">ipucu</p></div>\n      </details>',
        '<div class="tree-body"><p id="soil-hint">ipucu</p>'
      );
      expect(bad).not.toBe(GOOD);
      const r = check(bad);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/kapanmadan|yetim/);
    });

    it("yetim </div> yakalanır", () => {
      const bad = GOOD.replace("</main>", "</div>\n</main>");
      const r = check(bad);
      expect(r.status).toBe(1);
      expect(r.out).toContain("yetim");
    });

    it("panel düzeni sözleşmesi ihlali yakalanır (panel iç içe)", () => {
      const bad = GOOD.replace(
        '<section id="panel-stage"><div class="view-tabs"><span>s</span></div></section>',
        ""
      ).replace(
        "</details>\n    </div>",
        '</details>\n      <section id="panel-stage"><div class="view-tabs"><span>s</span></div></section>\n    </div>'
      );
      expect(bad).not.toBe(GOOD);
      const r = check(bad);
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/sözleşmesi/);
    });
  }
);
