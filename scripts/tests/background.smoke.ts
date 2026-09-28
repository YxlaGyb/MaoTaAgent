import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runScript } from "../../packages/shell/pwsh-local/src/background.ts";

const root = mkdtempSync(join(tmpdir(), "maota-background-"));
const previous = process.env.MAOTA_SCRIPTS_DIR;
process.env.MAOTA_SCRIPTS_DIR = root;
try {
  const path = join(root, "hello.ps1");
  writeFileSync(path, 'Write-Output "maota-background"\n', "utf8");
  const result = await runScript({ path, args: [], workdir: root, timeout_ms: 10_000 });
  assert.equal(result.exit_code, 0);
  assert.match(result.stdout, /maota-background/);
} finally {
  if (previous === undefined) delete process.env.MAOTA_SCRIPTS_DIR;
  else process.env.MAOTA_SCRIPTS_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
console.log("background smoke ok");