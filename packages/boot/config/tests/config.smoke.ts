import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { maotaHome, repoRoot, resolveConfigPath, writeDefaultConfig } from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "maota-config-"));
const home = join(dir, "home");
const env = { MAOTA_HOME: home } as NodeJS.ProcessEnv;

assert.equal(maotaHome(env), home);
assert.ok(maotaHome({} as NodeJS.ProcessEnv).endsWith(".maota"));

const generated = writeDefaultConfig(home);
assert.equal(generated, join(home, "eggshell.toml"));
const body = readFileSync(generated, "utf8");
assert.ok(body.includes("[plugins.hmr]"), "the default plugin set ships the hmr row");
assert.ok(body.includes("disabled = true"), "the hmr row ships disabled");
assert.ok(!body.includes("{{repo}}"), "every placeholder should be replaced by an absolute path");
assert.ok(body.includes(repoRoot.replaceAll("\\", "/")), "entries should carry the absolute repository path");

writeFileSync(join(home, "eggshell.local.toml"), "[plugins.api]\n");
assert.equal(resolveConfigPath({ env }), join(home, "eggshell.local.toml"));
assert.equal(resolveConfigPath({ env, explicit: join(dir, "given.toml") }), join(dir, "given.toml"));

const bare = join(dir, "nohome");
assert.equal(resolveConfigPath({ env, root: bare }), join(bare, "eggshell.toml"));
assert.ok(!existsSync(join(bare, "eggshell.toml")), "an injected root should not generate anything");

console.log("config ok: MAOTA_HOME, first-run generation, local layer wins");