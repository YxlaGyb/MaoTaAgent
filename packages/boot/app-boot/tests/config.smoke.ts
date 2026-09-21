import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  DEFAULT_PROFILE,
  PROFILE_TEMPLATES,
  bundlesOfProfile,
  ensureProfile,
  entryOf,
  maotaHome,
  profileDir,
  renderConfig,
  repoRoot,
  packageDir,
  resolveConfigPath,
  resolveKernelBin,
  rowsOfBundles,
} from "../src/index.ts";

const dir = mkdtempSync(join(tmpdir(), "maota-config-"));
const home = join(dir, "home");
const env = { MAOTA_HOME: home } as NodeJS.ProcessEnv;

assert.equal(maotaHome(env), home);
assert.ok(maotaHome({} as NodeJS.ProcessEnv).endsWith(".maota"));
assert.equal(profileDir(home, DEFAULT_PROFILE), join(home, "profiles", "default"));
assert.throws(() => profileDir(home, "nope"), /unknown profile/, "an unknown profile is refused by name");

const base = await rowsOfBundles(PROFILE_TEMPLATES["default"]!.bundles);
assert.deepEqual(
  base.map((row) => row.id),
  [
    "api",
    "pwsh-local",
    "permission",
    "tool-pwsh",
    "tool-fs",
    "tool-fs-search",
    "tools",
    "skill",
    "skill-filesystem",
    "session",
    "hooks",
    "agent-core",
    "hmr",
  ],
  "the default profile is the base bundle, in its order",
);
assert.equal(base.find((row) => row.id === "hmr")?.disabled, true, "the development watcher ships off");
assert.ok(!base.some((row) => row.id === "web"), "the web plugin belongs to the serve profile, not to the default one");

const serve = await rowsOfBundles(PROFILE_TEMPLATES["serve"]!.bundles);
assert.equal(serve.length, base.length + 1);
assert.equal(serve.at(-1)?.name, "@maota/web");

const generated = await ensureProfile(home, "default");
assert.equal(generated, join(home, "profiles", "default"));
const config = join(generated, "eggshell.toml");
assert.ok(existsSync(join(generated, "package.json")), "a first run writes the profile manifest");
assert.ok(existsSync(config), "a first run writes the generated config");

const manifest = JSON.parse(readFileSync(join(generated, "package.json"), "utf8")) as {
  maota?: { profile?: { bundles?: string[] } };
};
assert.deepEqual(manifest.maota?.profile?.bundles, ["@maota/base"], "the manifest records the profile's bundles");
assert.deepEqual(bundlesOfProfile(generated, "default"), ["@maota/base"], "the manifest is what boot reads back");

const body = readFileSync(config, "utf8");
for (const id of base.map((row) => row.id)) assert.ok(body.includes(`[plugins.${id}]`), `${id} should be configured`);
assert.ok(!body.includes("{{"), "a generated config carries resolved paths, not placeholders");
assert.ok(!body.includes("[plugins.web]"), "the default profile does not start the web plugin");

const names = [...body.matchAll(/^name = "([^"]+)"$/gm)].map((match) => match[1] ?? "");
assert.deepEqual(
  names,
  base.map((row) => row.name),
  "every row names its package, in the bundle's own order",
);
for (const name of names) {
  const link = join(generated, "node_modules", ...name.split("/"));
  assert.ok(existsSync(join(link, "package.json")), `the profile does not link ${name}`);
  assert.equal(realpathSync(link), realpathSync(packageDir(name)), `${name} should point at the repository copy`);
}

const rewritten = readFileSync(config, "utf8");
await ensureProfile(home, "default");
assert.equal(readFileSync(config, "utf8"), rewritten, "a second boot rewrites nothing");

await ensureProfile(home, "serve");
assert.ok(
  readFileSync(join(home, "profiles", "serve", "eggshell.toml"), "utf8").includes("[plugins.web]"),
  "the serve profile starts the web plugin",
);

writeFileSync(join(generated, "eggshell.local.toml"), "[plugins.api]\n");
assert.equal(
  await resolveConfigPath({ env, home }),
  join(generated, "eggshell.local.toml"),
  "the user layer wins when it exists",
);
assert.equal(await resolveConfigPath({ env, home, explicit: join(dir, "given.toml") }), join(dir, "given.toml"));
assert.equal(await resolveConfigPath({ env, home, profile: "serve" }), join(home, "profiles", "serve", "eggshell.toml"));

const scratch = mkdtempSync(join(tmpdir(), "maota-bundles-"));
function bundle(name: string, manifest: Record<string, unknown>, rows?: string): void {
  const pkg = join(scratch, "packages", name.replace("/", "-"));
  mkdirSync(join(pkg, "src"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name,
      private: true,
      type: "module",
      exports: { ".": "./src/index.ts", "./package.json": "./package.json" },
      ...manifest,
    }),
  );
  if (rows !== undefined) writeFileSync(join(pkg, "src", "rows.ts"), rows);
  const link = join(scratch, "node_modules", ...name.split("/"));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(pkg, link, "junction");
}
writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "scratch", private: true, type: "module" }));
bundle("@scratch/good", { maota: { bundle: { rows: "./src/rows.ts" } } }, 'export const rows = [{ id: "one", name: "@scratch/good" }];\n');
bundle("@scratch/silent", {});
bundle("@scratch/nameless", { maota: { bundle: { rows: "./src/rows.ts" } } }, 'export const rows = [{ id: "one", name: "@scratch/nameless" }];\n');
bundle(
  "@scratch/broken",
  { maota: { bundle: { rows: "./src/rows.ts" } } },
  'export const rows = [{ id: "ghost", name: "@scratch/ghost" }];\n',
);

assert.deepEqual(
  (await rowsOfBundles(["@scratch/good"], scratch)).map((row) => row.id),
  ["one"],
  "a bundle's rows are read through its own maota.bundle.rows",
);
await assert.rejects(() => rowsOfBundles(["@scratch/silent"], scratch), /declares no maota\.bundle\.rows/);
await assert.rejects(() => rowsOfBundles(["@scratch/good", "@scratch/nameless"], scratch), /listed twice/);
await assert.rejects(() => rowsOfBundles(["@scratch/missing"], scratch), /cannot find @scratch\/missing/);
assert.throws(() => entryOf("@scratch/missing", scratch), /cannot resolve the entry of @scratch\/missing/);

const orphanHome = mkdtempSync(join(tmpdir(), "maota-orphan-"));
const orphan = join(orphanHome, "profiles", "default");
mkdirSync(orphan, { recursive: true });
writeFileSync(
  join(orphan, "package.json"),
  JSON.stringify({ name: "maota-profile-default", private: true, maota: { profile: { bundles: ["@scratch/broken"] } } }),
);
await assert.rejects(
  () => ensureProfile(orphanHome, "default", scratch),
  /the row ghost names @scratch\/ghost/, 
  "a row whose package does not resolve stops the boot with its id and package",
);

assert.equal(renderConfig([]).includes("[plugins."), false, "an empty bundle list renders no rows");
assert.ok(resolveKernelBin({ installed: null, root: repoRoot, env: {} as NodeJS.ProcessEnv }).length > 0);

console.log("config ok: profiles, bundle rows, generated config, the user layer on top");
