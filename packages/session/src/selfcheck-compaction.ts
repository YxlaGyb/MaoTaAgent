import { existsSync, readFileSync } from "node:fs";

import { messageSource } from "./document.ts";
import { commitCompaction, load, save, saveArtifact, type Limits } from "./store.ts";

export function checkCompaction(root: string, limits: Limits, problems: string[]): void {
  const compact = {
    role: "user",
    name: "compact",
    content: "folded note",
    source: { kind: "compact", id: "compact-one", folded: 3, trigger: "manual" },
  };
  save(root, { id: "compact", cwd: "E:\\proj", messages: [compact] }, limits);
  const restoredCompact = load(root, "compact", "E:\\proj", limits);
  const compactSource = messageSource(restoredCompact.messages[0]?.source);
  if (compactSource?.kind !== "compact" || compactSource.folded !== 3 || compactSource.trigger !== "manual") {
    problems.push(`a compact source came back as ${JSON.stringify(compactSource)}`);
  }
  const artifact = saveArtifact(root, {
    id: "compact",
    cwd: "E:\\proj",
    name: "tool-output",
    content: "full output",
  });
  if (!existsSync(artifact.path) || readFileSync(artifact.path, "utf8") !== "full output") {
    problems.push("a saved artifact did not round-trip");
  }
  commitCompaction(
    root,
    {
      id: "compact",
      cwd: "E:\\proj",
      messages: [compact],
      record: {
        id: "compact-one",
        at: new Date().toISOString(),
        trigger: "manual",
        kind: "summary",
        status: "committed",
        folded: 3,
        chars_before: 900,
        chars_after: 300,
        artifacts: [artifact],
      },
      archive: { messages: [{ role: "user", content: "old" }] },
    },
    limits,
  );
  const committed = load(root, "compact", "E:\\proj", limits);
  if (committed.compactions.length !== 1 || committed.compactions[0]?.archive?.messages !== 1) {
    problems.push(`a compaction record did not round-trip: ${JSON.stringify(committed.compactions)}`);
  }
  if (committed.compactions[0]?.archive === undefined || !existsSync(committed.compactions[0].archive.path)) {
    problems.push("a compaction archive was not written");
  }
}
