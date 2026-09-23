import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { isSkillName, parseFrontmatter, projectSkill, renderCatalog, summarize } from "../src/protocol.ts";

assert.equal(isSkillName("code-review"), true);
assert.equal(isSkillName("a"), true);
assert.equal(isSkillName("a1-b2"), true);
for (const bad of ["Code-Review", "code_review", "code--review", "-lead", "trail-", "", "code review", 7, undefined]) {
  assert.equal(isSkillName(bad), false, `${JSON.stringify(bad)} is not a skill name`);
}

const parsed = parseFrontmatter("---\nname: demo\ndescription: about demo\nallowed-tools: read\npaths:\n  - src/**\n---\n\nBody.\n");
assert.deepEqual(parsed.data, {
  name: "demo",
  description: "about demo",
  "allowed-tools": "read",
  paths: ["src/**"],
});
assert.equal(parsed.body, "Body.\n");
assert.deepEqual(parseFrontmatter("no front matter").data, {});
assert.deepEqual(parseFrontmatter("---\nname: demo\n").body, "---\nname: demo\n");

const source = { data: parsed.data, unsupported: parsed.unsupported, body: parsed.body, fallbackName: "demo", source: "user" };
const projected = projectSkill(source);
assert.equal(projected.ok, true);
if (projected.ok) {
  assert.equal(projected.entry.source, "user");
  assert.equal(projected.entry.description, "about demo");
  assert.deepEqual(projected.entry.allowedTools, ["read"]);
  assert.deepEqual(projected.entry.paths, ["src/**"]);
}
const mismatched = projectSkill({ ...source, data: { ...parsed.data, name: "other" } });
assert.equal(mismatched.ok, false);
const unreadable = projectSkill({ ...source, data: { "user-invocable": "sometimes" } });
assert.equal(unreadable.ok, false);
const quiet = projectSkill({ ...source, data: { "disable-model-invocation": "yes" } });
assert.equal(quiet.ok, true);
if (quiet.ok) assert.equal(quiet.entry.invocation.modelInvocable, false);
const loose = projectSkill({ ...source, data: { description: "kept", paths: 7 } });
assert.equal(loose.ok, true);
if (loose.ok) {
  assert.equal(loose.entry.paths, undefined);
  assert.equal(loose.warnings.length, 1);
}

/// Every key this build reads really lands on the entry, and every key it does
/// not read really disappears: the contract is that nothing in the frontmatter
/// is half-understood.
const full = projectSkill({
  ...source,
  data: {
    name: "demo",
    description: "about demo",
    "when-to-use": "while demoing",
    "user-invocable": "no",
    "disable-model-invocation": "on",
    "allowed-tools": ["read", "grep"],
    model: "small",
    context: "fork",
    hooks: [{ event: "PreToolUse", command: "check.ps1", matcher: "pwsh" }],
    paths: ["src/**"],
    mystery: "ignored",
  },
});
assert.equal(full.ok, true);
if (full.ok) {
  assert.deepEqual(full.entry.invocation, { modelInvocable: false, userInvocable: false });
  assert.deepEqual(full.entry.allowedTools, ["read", "grep"]);
  assert.deepEqual(full.entry.paths, ["src/**"]);
  assert.equal(full.entry.model, "small");
  assert.equal(full.entry.context, "fork");
  assert.equal(full.entry.whenToUse, "while demoing");
  assert.deepEqual(full.entry.hooks, [{ event: "PreToolUse", command: "check.ps1", matcher: "pwsh" }]);
  assert.equal(Object.hasOwn(full.entry, "mystery"), false, "an unknown key should not be kept");
}

/// The other spelling of the same key reads the same key: a document written
/// against the underscore dialect must not silently lose its narrowing.
const underscored = projectSkill({
  ...source,
  data: { description: "kept", allowed_tools: ["read"], when_to_use: "now" },
});
assert.equal(underscored.ok, true);
if (underscored.ok) {
  assert.deepEqual(underscored.entry.allowedTools, ["read"]);
  assert.equal(underscored.entry.whenToUse, "now");
}

/// A narrowing this build cannot read drops the skill rather than handing back
/// the wider surface the author was closing.
for (const broken of [{ "allowed-tools": 7 }, { "allowed-tools": [7] }, { "allowed-tools": "read write" }]) {
  assert.equal(projectSkill({ ...source, data: broken }).ok, false, `${JSON.stringify(broken)} should be refused`);
}
/// A routing hint only loses itself.
for (const loose2 of [{ model: 7 }, { context: "sometimes" }, { hooks: "not a list" }]) {
  const result = projectSkill({ ...source, data: { description: "kept", ...loose2 } });
  assert.equal(result.ok, true, `${JSON.stringify(loose2)} should not drop the skill`);
}

/// A hook list in the block form a person actually writes is read with the
/// event, the command, the matcher and the timeout it declares.
const block = parseFrontmatter(
  ["---", "hooks:", "  - event: PostToolUse", "    command: audit.ps1", "    timeout_ms: 2500", "---", "", "b", ""].join("\n"),
);
assert.deepEqual(block.data.hooks, [{ event: "PostToolUse", command: "audit.ps1", timeout_ms: "2500" }]);

const summary = summarize(
  { name: "demo", description: "about demo", source: "user", invocation: { modelInvocable: true, userInvocable: true } },
  "skill.filesystem",
  true,
);
assert.deepEqual(summary, {
  name: "demo",
  description: "about demo",
  source: "user",
  invocation: { modelInvocable: true, userInvocable: true },
  provider: "skill.filesystem",
  active: true,
});

const short = renderCatalog([{ name: "demo", description: "x".repeat(60) }], { descriptionMax: 10, totalMax: 8000 });
assert.ok(short.includes("…"), "a long description should be cut");
assert.ok(short.includes('<skill name="demo">'), "the catalog should keep the entry");
assert.ok(short.includes("</available_skills>"), "the catalog should close its block");
const bounded = renderCatalog(
  [
    { name: "one", description: "x".repeat(40) },
    { name: "two", description: "y".repeat(40) },
  ],
  { descriptionMax: 40, totalMax: 60 },
);
assert.ok(bounded.includes("<omitted"), `a bounded catalog lost its note: ${bounded}`);

const entry = join(import.meta.dirname, "..", "src", "index.ts");
const run = spawnSync(process.execPath, [entry, "--check"], { encoding: "utf8" });
assert.equal(run.status, 0, `the registry entry exited ${run.status}: ${(run.stderr ?? "").slice(-400)}`);
const report = JSON.parse(((run.stdout ?? "").trim().split("\n").at(-1) ?? "")) as {
  ok?: boolean;
  provides?: string[];
  problems?: string[];
};
assert.equal(report.ok, true, `the registry selfCheck reported ${JSON.stringify(report.problems)}`);
assert.deepEqual(report.provides, ["skill"]);

console.log("skill ok: frontmatter, projection, catalog bounds, the registry entry --check report");
