import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as YAML from "yaml";
import { makeTempProject, baseSprint } from "./fixtures.js";
import { getOrInitConfig } from "../src/tools/get-or-init-config.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup() {
  const tmp = await makeTempProject(JSON.parse(JSON.stringify(baseSprint)));
  cleanups.push(tmp.cleanup);
  return tmp;
}

describe("getOrInitConfig", () => {
  it("auto-detects BMAD v6 layout when sprint-status + docs/ exist", async () => {
    const { ctx } = await setup();
    await fs.mkdir(path.join(ctx.projectRoot, "docs"), { recursive: true });
    await fs.writeFile(path.join(ctx.projectRoot, "docs/prd.md"), "# prd", "utf8");

    const r = await getOrInitConfig(ctx);
    expect(r.needsSetup).toBe(false);
    expect(r.config?.layout).toBe("bmad-v6");
    expect(r.config?.autoDetected).toBe(true);
    expect(r.config?.prdPath).toBe("docs/prd.md");

    // Config is now persisted; second call reads from disk
    const r2 = await getOrInitConfig(ctx);
    expect(r2.config?.autoDetected).toBe(true);
  });

  it("returns needsSetup with prompts when no layout is recognised", async () => {
    const { ctx } = await setup();
    await fs.rm(ctx.sprintStatusPath);
    const r = await getOrInitConfig(ctx);
    expect(r.needsSetup).toBe(true);
    expect(r.config).toBeNull();
    expect(r.setupQuestions?.length ?? 0).toBeGreaterThan(0);
  });

  it("reads an existing config in preference to auto-detect", async () => {
    const { ctx } = await setup();
    await fs.mkdir(path.dirname(ctx.configPath), { recursive: true });
    await fs.writeFile(
      ctx.configPath,
      YAML.stringify({
        sprintStatusPath: "sprint-status.yaml",
        layout: "custom",
        autoDetected: false,
        prdPath: "PRD.md",
      }),
      "utf8",
    );
    const r = await getOrInitConfig(ctx);
    expect(r.config?.layout).toBe("custom");
    expect(r.config?.prdPath).toBe("PRD.md");
  });
});
