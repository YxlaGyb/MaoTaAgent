import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { kernel as installed } from "eggshell-kernel";

import { boot } from "@maota/host";

const SHORT = "the short answer.";
const LONG = "lorem-ipsum-".repeat(1400);

const root = join(import.meta.dirname, "..", "..", "..");
const bin =
  process.argv[2] ??
  process.env.EGGSHELL_BIN ??
  installed ??
  join(root, "..", "eggshellmod", "target", "debug", "eggshell.exe");

const PLUGINS: Array<[string, string]> = [
  ["api", "packages/api/src/index.ts"],
  ["pwsh-local", "packages/shell/pwsh-local/src/index.ts"],
  ["tool-pwsh", "packages/shell/tool-pwsh/src/index.ts"],
  ["tool-fs", "packages/fs/tool-fs/src/index.ts"],
  ["tool-fs-search", "packages/fs/tool-fs-search/src/index.ts"],
  ["tools", "packages/agent/tools/src/index.ts"],
  ["skill-filesystem", "packages/skill-filesystem/src/index.ts"],
  ["skill", "packages/skill/src/index.ts"],
  ["session", "packages/session/src/index.ts"],
  ["agent-core", "packages/agent/agent-core/src/index.ts"],
  ["web", "apps/web/src/index.ts"],
];

const home = mkdtempSync(join(tmpdir(), "maota-web-"));
const config = join(home, "eggshell.local.toml");

writeFileSync(
  join(home, "eggshell.toml"),
  PLUGINS.map(
    ([id, main]) => `[plugins.${id}]\ncommand = '${process.execPath}'\nargs = ['${join(root, main)}']\n`,
  ).join("\n"),
);

writeFileSync(
  config,
  [
    'extends = ["eggshell.toml"]',
    "",
    "[plugins.api.config]",
    'backend = "scripted"',
    'model = "smoke-chat"',
    "script = [",
    `  { text = '${SHORT}' },`,
    `  { text = '${LONG}' },`,
    "  { },",
    "  { text = 'first workdir turn' },",
    "  { text = 'unused next step' },",
    "]",
    "",
    "[plugins.agent-core.config.thinking]",
    'off = "smoke-chat"',
    'medium = { model = "smoke-reasoner", tools = false }',
    "",
    "[plugins.web.config]",
    "port = 0",
    "dev = false",
    "",
  ].join("\n"),
);

interface Frame {
  event?: string;
  turn_id?: string;
  session_id?: string;
  text?: string;
  code?: number;
  message?: string;
}

const logs: string[] = [];
const kernel = await boot(config, {
  bin,
  env: { ...process.env, MAOTA_HOME: home },
  onLog: (line) => logs.push(`${String(line.level ?? "?")} ${String(line.message ?? JSON.stringify(line))}`),
});

const info = (await kernel.invoke("web", "info")) as {
  url: string;
  version: string;
  dev: boolean;
  sessions_dir: string | null;
  levels: string[];
  thinking: Record<string, { model?: string; tools?: boolean }> | null;
};
const base = info.url;

const events: Frame[] = [];
const watchers: Array<(event: Frame) => void> = [];
let finished = false;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method: string, params: unknown = {}): Promise<any> {
  const response = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const payload = (await response.json()) as { result?: any; error?: { code: number; message: string } };
  if (payload.error) throw Object.assign(new Error(payload.error.message), { code: payload.error.code });
  return payload.result;
}

async function listen(): Promise<void> {
  const response = await fetch(`${base}/events`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end < 0) break;
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as Frame;
        events.push(event);
        for (const watch of [...watchers]) watch(event);
      }
    }
  }
}

function waitFor(match: (event: Frame) => boolean, timeout = 30_000): Promise<Frame> {
  return new Promise((resolve, reject) => {
    const seen = events.find(match);
    if (seen) {
      resolve(seen);
      return;
    }
    const watch = (event: Frame): void => {
      if (!match(event)) return;
      clearTimeout(timer);
      watchers.splice(watchers.indexOf(watch), 1);
      resolve(event);
    };
    const timer = setTimeout(() => {
      watchers.splice(watchers.indexOf(watch), 1);
      reject(new Error(`no matching event after ${timeout}ms; plugin log: ${logs.slice(-5).join(" | ")}`));
    }, timeout);
    watchers.push(watch);
  });
}

function textOf(turnId: string): string {
  return events
    .filter((event) => event.event === "text" && event.turn_id === turnId)
    .map((event) => event.text ?? "")
    .join("");
}

async function turn(session: string, input: string, cwd = "", thinking = "off"): Promise<string> {
  return (await call("chat.send", { session_id: session, cwd, input, thinking })).turn_id as string;
}

let passed = 0;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  await run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log(`web smoke: ${base}\n`);

await check("app.info", async () => {
  const appInfo = await call("app.info");
  assert.equal(appInfo.url, base, "app.info and web/info should report the same URL");
  assert.equal(appInfo.listening, true, "the plugin should be listening on that URL");
  assert.equal(appInfo.version, info.version, "both should report the same version");
  assert.equal(appInfo.dev, false, "config.dev should win over NODE_ENV");
  assert.equal(appInfo.thinking?.medium?.model, "smoke-reasoner", "levels should come from the agent plugin");
  assert.equal(appInfo.thinking?.medium?.tools, false, "the level's tools flag should come through");
  assert.ok(appInfo.levels.includes("medium"), `levels should contain medium, got ${JSON.stringify(appInfo.levels)}`);
  assert.ok(
    appInfo.sessions_dir?.startsWith(home) === true,
    `sessions dir should live under MAOTA_HOME, got ${appInfo.sessions_dir}`,
  );
  assert.deepEqual((await call("sessions.list")).sessions, [], "a fresh home should list no sessions");
});

await check("ui", async () => {
  const page = await fetch(`${base}/`);
  if (existsSync(join(root, "apps", "web", "dist", "index.html"))) {
    assert.equal(page.status, 200, "/ should serve dist/index.html");
    assert.ok((await page.text()).includes('id="root"'), "what dist serves should be the UI");
  } else {
    assert.equal(page.status, 404, "with no build, / should say so instead of 404-ing to a blank page");
  }
});

await check("api key from the page", async () => {
  assert.equal((await call("app.info")).has_key, false, "a fresh home should report no key");
  assert.equal((await call("settings.set_key", { api_key: "sk-smoke" })).has_key, true, "saving should report back");
  assert.equal((await call("app.info")).has_key, true, "app.info should see it right away");
  assert.equal(readFileSync(join(home, "api_key"), "utf8").trim(), "sk-smoke", "the key should be on disk");
});

void listen().catch((error: unknown) => {
  if (!finished) console.error(`event stream broke: ${String(error)}`);
});
await sleep(200);

await check("streaming turn", async () => {
  const id = await turn("smoke-one", "short");
  const started = await waitFor((event) => event.event === "turn.start" && event.turn_id === id);
  assert.equal(started.session_id, "smoke-one", "turn.start should carry the session id");
  await waitFor((event) => event.event === "turn.done" && event.turn_id === id);
  assert.equal(textOf(id), SHORT, "the streamed text should add up");

  const one = join(home, "sessions", "default", "smoke-one.json");
  assert.ok(existsSync(one), `the session should be written to ${one}`);
  if (process.platform !== "win32") {
    assert.equal(statSync(one).mode & 0o777, 0o600, "the session file should not be 0644");
  }
  const loaded = await call("sessions.load", { id: "smoke-one", cwd: "" });
  assert.deepEqual(
    loaded.messages.map((message: { role: string }) => message.role),
    ["user", "assistant"],
  );
  assert.equal(loaded.dangling, false, "a finished turn is not dangling");
});

await check("long turn flushes mid-stream", async () => {
  const id = await turn("smoke-long", "long");
  await waitFor((event) => event.event === "turn.done" && event.turn_id === id);
  const chunks = events.filter((event) => event.event === "text" && event.turn_id === id);
  assert.ok(chunks.length >= 3, `a long answer should arrive in several chunks, got ${chunks.length}`);
  assert.equal(textOf(id), LONG, "the long answer should add up");
});

await check("half turn stays dangling on disk", async () => {
  const id = await turn("smoke-half", "half");
  const error = await waitFor((event) => event.event === "turn.error" && event.turn_id === id);
  assert.equal(error.code, -32602, `the scripted backend should report -32602, got ${error.code}`);
  const half = await call("sessions.load", { id: "smoke-half", cwd: "" });
  assert.equal(half.dangling, true, "a turn cut in half should be marked dangling");
  assert.equal(half.messages.length, 1, "only the user message should survive");
});

await check("cwd: encoded dir and identity", async () => {
  const workdir = "E:\\proj\\x-y";
  const id = await turn("smoke-cwd", "workdir", workdir);
  await waitFor((event) => event.event === "turn.done" && event.turn_id === id);
  const encoded = workdir.replace(/[^A-Za-z0-9]/g, "-");
  assert.ok(existsSync(join(home, "sessions", encoded, "smoke-cwd.json")), `${workdir} should land in ${encoded}/`);
  const listed = (await call("sessions.list")).sessions as Array<{ id: string; cwd: string }>;
  assert.equal(
    listed.find((item) => item.id === "smoke-cwd")?.cwd,
    workdir,
    "the listed cwd should be the real one from the file",
  );
  assert.equal(listed.find((item) => item.id === "smoke-one")?.cwd, "", "an empty cwd should be listed too");

  const clash = await turn("smoke-cwd", "clash", "E:/proj/x/y");
  const clashError = await waitFor((event) => event.event === "turn.error" && event.turn_id === clash);
  assert.equal(clashError.code, -32602, `the same id in a clashing dir should be rejected, got ${clashError.code}`);
});

await check("rejects bad input", async () => {
  await assert.rejects(
    call("chat.cancel", { turn_id: "no-such-turn" }),
    (error: { code?: number }) => error.code === -32602,
    "cancelling an unknown turn should be -32602",
  );
  await assert.rejects(
    call("chat.send", { session_id: "smoke-one", cwd: "", input: "   ", thinking: "off" }),
    (error: { code?: number }) => error.code === -32602,
    "blank input should be rejected",
  );
  const bogus = await turn("smoke-one", "x", "", "no-such-level");
  const bogusError = await waitFor((event) => event.event === "turn.error" && event.turn_id === bogus);
  assert.equal(bogusError.code, -32602, `an unknown level should report -32602 in the stream, got ${bogusError.code}`);
});

finished = true;
const code = await kernel.shutdown("ui_quit");
if (process.platform !== "win32") assert.equal(code, 0, `the kernel should exit cleanly, got ${code}`);

await assert.rejects(
  fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "app.info", params: {} }),
  }),
  "the web plugin should stop answering once the kernel is gone",
);

console.log(`\nweb smoke: ${passed} checks passed`);
