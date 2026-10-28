// Contract suite for src/lib/logsDir.js.
//
// Request/debug logs MUST NOT land inside the repository working tree: the
// Tailwind scan base and the Turbopack dev watcher both key off the project
// directory, so a log file written into <repo>/logs invalidated the CSS
// transform on every request and the dev cache grew to ~10GB.
//
// Pinned here:
//   1. the default base is <DATA_DIR>/logs, never <cwd>/logs;
//   2. REQUEST_LOGS_DIR wins, absolute or relative (relative resolves to cwd);
//   3. consumers (requestLogger, the translator save/load routes) follow it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// tests/unit/.. -> repo root, independent of the directory vitest was started in.
const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

const ENV_KEYS = ["REQUEST_LOGS_DIR", "DATA_DIR", "ENABLE_REQUEST_LOGS"];
const savedEnv = {};
let tmpRoot;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "9router-logs-dir-"));
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const isInside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const loadLogsDir = async () => {
  vi.resetModules();
  return import("@/lib/logsDir.js");
};

describe("logsDir: base directory resolution", () => {
  it("defaults to <DATA_DIR>/logs, outside the repository", async () => {
    process.env.DATA_DIR = tmpRoot;
    const { LOGS_DIR, getLogsDir } = await loadLogsDir();

    expect(LOGS_DIR).toBe(path.join(tmpRoot, "logs"));
    expect(getLogsDir()).toBe(LOGS_DIR);
    expect(isInside(LOGS_DIR, REPO_ROOT)).toBe(false);
  });

  it("honors an absolute REQUEST_LOGS_DIR over DATA_DIR", async () => {
    const override = path.join(tmpRoot, "explicit");
    process.env.DATA_DIR = path.join(tmpRoot, "data");
    process.env.REQUEST_LOGS_DIR = override;

    const { LOGS_DIR } = await loadLogsDir();

    expect(LOGS_DIR).toBe(override);
    expect(isInside(LOGS_DIR, REPO_ROOT)).toBe(false);
  });

  it("resolves a relative REQUEST_LOGS_DIR against the cwd", async () => {
    process.env.REQUEST_LOGS_DIR = "9router-relative-logs";

    const { LOGS_DIR } = await loadLogsDir();

    expect(path.isAbsolute(LOGS_DIR)).toBe(true);
    expect(LOGS_DIR).toBe(path.resolve("9router-relative-logs"));
  });
});

describe("logsDir: consumers follow the resolved base", () => {
  it("requestLogger writes request sessions under the resolved base, not into the repo", async () => {
    const base = path.join(tmpRoot, "requests");
    process.env.REQUEST_LOGS_DIR = base;
    process.env.ENABLE_REQUEST_LOGS = "true";
    vi.resetModules();

    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "claude", "test/model");

    expect(logger.sessionPath).toBeTruthy();
    expect(isInside(logger.sessionPath, base)).toBe(true);
    expect(isInside(logger.sessionPath, REPO_ROOT)).toBe(false);

    logger.logClientRawRequest("/v1/chat/completions", { model: "test/model" });
    expect(fs.readdirSync(logger.sessionPath)).toContain("1_req_client.json");
  });

  it("requestLogger stays a no-op when logging is disabled", async () => {
    const base = path.join(tmpRoot, "disabled");
    process.env.REQUEST_LOGS_DIR = base;
    vi.resetModules();

    const { createRequestLogger } = await import("open-sse/utils/requestLogger.js");
    const logger = await createRequestLogger("openai", "claude", "test/model");

    expect(logger.sessionPath).toBeNull();
    expect(fs.existsSync(base)).toBe(false);
  });

  it("translator save/load round-trips through <logs base>/translator", async () => {
    process.env.REQUEST_LOGS_DIR = tmpRoot;
    vi.resetModules();

    const { POST } = await import("@/app/api/translator/save/route.js");
    const { GET } = await import("@/app/api/translator/load/route.js");

    const saved = await POST({
      json: async () => ({ file: "4_req_target.json", content: '{"a":1}' }),
    });
    expect(await saved.json()).toEqual({ success: true });

    const onDisk = path.join(tmpRoot, "translator", "4_req_target.json");
    expect(fs.readFileSync(onDisk, "utf-8")).toBe('{"a":1}');

    const loaded = await GET({
      url: "http://localhost/api/translator/load?file=4_req_target.json",
    });
    expect(await loaded.json()).toEqual({ success: true, content: '{"a":1}' });
  });

  it("translator load still rejects paths outside the allow-list", async () => {
    process.env.REQUEST_LOGS_DIR = tmpRoot;
    vi.resetModules();

    const { GET } = await import("@/app/api/translator/load/route.js");
    const res = await GET({
      url: "http://localhost/api/translator/load?file=../../../etc/passwd",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
  });
});
