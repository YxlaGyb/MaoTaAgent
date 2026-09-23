/// The agent runs the self check drives: a subagent that keeps its parent's
/// identity and events, a parent whose level a child inherits, the durable skill
/// catalog that appends a replacement rather than repeating itself, the bad
/// parameters a run must refuse, and the mapping from a hook outcome to a loop
/// decision. Everything here goes through the rig in `selfcheck-rig.ts`.

import type { Definition, Wiring } from "@maota/plugin-kit";
import type { Message } from "@maota/agent-loop";
import { asPreTool, asPostTool, asStop, DENIED, hasOpinion } from "./hooks.ts";
import type { Rig } from "./selfcheck-rig.ts";

export async function checkAgentRuns(definition: Definition, rig: Rig, problems: string[]): Promise<void> {
  // The registry is what decides whether a catalog exists, so it is announced
  // the way a deployment announces it: through the capability table the kernel
  // passes to start.
  definition.start?.({
    channel: { log: (): void => {} },
    config: {},
    capabilities: { skill: { plugin: "@maota/skill" } },
  } as unknown as Wiring);

  const explore = rig.run(
    {
      session_id: "sub-a",
      cwd: "E:\\proj",
      input: "find where the loader is registered",
      origin: { parent_session_id: "p1", parent_call_id: "c1", type: "explore", description: "look at the loader" },
      system: "you are an explore subagent",
      tools_allow: ["read"],
      tools_deny: ["task"],
      max_steps: 3,
    },
    [rig.scripted("", "write"), rig.scripted("the loader is in graph.rs")],
  );
  await explore.done;
  if (explore.chat.length !== 2) problems.push(`the subagent ran ${explore.chat.length} steps, expected 2`);
  if (rig.surfaced(explore.chat) !== "read") problems.push(`the explore subagent listed ${rig.surfaced(explore.chat)}`);
  const opening = explore.chat[0]?.messages ?? [];
  if (opening[1]?.role !== "user" || opening[1]?.content !== "find where the loader is registered") {
    problems.push(`the subagent opened with ${JSON.stringify(opening.slice(0, 3))}`);
  }
  const brief = explore.chat[0]?.messages[0]?.content ?? "";
  if (!brief.startsWith("you are an explore subagent")) {
    problems.push("the subagent kept the deployment system prompt over its own");
  }
  if (!brief.includes("working directory: E:\\proj") || !brief.includes("approval: ask")) {
    problems.push(`the subagent prompt lost its place and policy: ${JSON.stringify(brief)}`);
  }
  if (explore.heard.some((item) => item.capability === "session" && item.method === "load")) {
    problems.push("the subagent read the history it was meant to start without");
  }
  if (explore.heard.some((item) => item.capability === "skill")) problems.push("a subagent was offered skills");
  if (explore.heard.some((item) => item.capability === "tools" && item.method === "call")) {
    problems.push("a tool the subagent does not have was still run");
  }
  const blocked = explore.events.find((event) => event.type === "tool_result") as
    | { ok?: boolean; output?: unknown }
    | undefined;
  if (blocked === undefined || blocked.ok !== false || !String(blocked.output).includes("not available to this subagent")) {
    problems.push(`a tool outside the subagent surface came out as ${JSON.stringify(blocked)}`);
  }
  const saved = rig.saves.at(-1) ?? null;
  if (saved?.parent?.id !== "p1" || saved.parent.call_id !== "c1" || saved.parent.type !== "explore") {
    problems.push(`the subagent session was saved as ${JSON.stringify(saved?.parent)}`);
  }
  if (saved?.title !== "look at the loader") problems.push(`the subagent session was titled ${JSON.stringify(saved?.title)}`);
  if (((saved?.messages ?? []) as Message[]).some((message) => message.name === "skill-catalog")) {
    problems.push("a subagent session was given a catalog note");
  }
  const topics = explore.sent.map((item) => item.topic).join(",");
  if (
    topics !==
    "agent.subagent.started,agent.subagent.step,agent.subagent.tool_call,agent.subagent.tool_result," +
      "agent.subagent.step,agent.subagent.finished"
  ) {
    problems.push(`the subagent published ${JSON.stringify(topics)}`);
  }
  const head = explore.sent[0]?.payload ?? {};
  if (head.subagent_id !== "sub-a" || head.parent_session_id !== "p1" || head.parent_call_id !== "c1") {
    problems.push(`the first subagent event carried ${JSON.stringify(head)}`);
  }
  if (explore.sent.some((item) => item.payload.description !== "look at the loader")) {
    problems.push("a subagent event lost the description");
  }

  const general = rig.run(
    {
      session_id: "sub-b",
      cwd: "E:\\proj",
      input: "summarise the tree",
      origin: { parent_session_id: "p1", parent_call_id: "c2", type: "general", description: "summarise" },
      tools_deny: ["task", "skill"],
    },
    [rig.scripted("", "task"), rig.scripted("done")],
  );
  await general.done;
  if (rig.surfaced(general.chat) !== "read,write") {
    problems.push(`the general subagent listed ${rig.surfaced(general.chat)}`);
  }
  if (general.heard.some((item) => item.capability === "tools" && item.method === "call")) {
    problems.push("the tool that spawns subagents ran inside a subagent");
  }
  if (general.heard.some((item) => item.capability === "skill")) {
    problems.push("a subagent asked for a skill catalog");
  }

  rig.history = [
    { role: "user", content: "earlier" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "h1", function: { name: "read", arguments: JSON.stringify({ file_path: "packages/agent/x.ts" }) } },
      ],
    },
  ];
  definition.setup?.({ channel: undefined, config: { thinking: { low: "m-low" } }, capabilities: {} } as unknown as Wiring);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const parent = rig.run(
    { session_id: "p1", cwd: "E:\\proj", input: "hi", thinking: "low" },
    [rig.scripted("parent done")],
    held,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (rig.surfaced(parent.chat) !== "read,write,task,skill") {
    problems.push(`the parent listed ${rig.surfaced(parent.chat)}`);
  }
  const inherited = rig.run(
    {
      session_id: "sub-c",
      cwd: "E:\\proj",
      input: "child",
      origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
    },
    [rig.scripted("child done")],
  );
  await inherited.done;
  if (inherited.chat[0]?.model !== "m-low") {
    problems.push(`a subagent ran on model ${JSON.stringify(inherited.chat[0]?.model)}, expected the parent's`);
  }
  if (rig.surfaced(inherited.chat) !== "read,write,task,skill") {
    problems.push(`the skill tool stopped being an ordinary tool: ${rig.surfaced(inherited.chat)}`);
  }
  release();
  await parent.done;
  if (!parent.heard.some((item) => item.capability === "session" && item.method === "load")) {
    problems.push("the parent skipped its own history");
  }

  const noteOf = (entries: Array<{ name: string; description: string }>, update = false): Message => ({
    role: "user",
    name: "skill-catalog",
    content: "catalog text",
    source: { kind: "skill-catalog", ...(update ? { update: true } : {}), entries },
  });
  const catalogNotes = (saved: Record<string, any> | undefined): Message[] =>
    ((saved?.messages ?? []) as Message[]).filter((message) => message.name === "skill-catalog");
  const entries = [{ name: "s", description: "d" }];

  const parentSave = rig.saves.at(-1);
  const parentNotes = catalogNotes(parentSave);
  if (parentNotes.length !== 1) problems.push(`the parent kept ${parentNotes.length} catalog notes, expected 1`);
  const note = parentNotes[0]?.source as { kind?: unknown; entries?: unknown; update?: unknown } | undefined;
  if (note?.kind !== "skill-catalog") problems.push(`the catalog note carried ${JSON.stringify(note)}`);
  if ((note?.entries as unknown[] | undefined)?.length !== 1) problems.push("the catalog note lost its entries");
  if (note?.update !== undefined) problems.push("a first catalog note claimed to be an update");
  const askedFor = parent.heard.find((item) => item.capability === "skill");
  if (askedFor?.method !== "catalog") problems.push(`the parent asked the registry for ${String(askedFor?.method)}`);
  if ((askedFor?.params?.touched ?? []).includes("E:\\proj\\packages\\agent\\x.ts") !== true) {
    problems.push(`the catalog call carried ${JSON.stringify(askedFor?.params?.touched)}`);
  }
  if (askedFor?.params?.cwd !== "E:\\proj") {
    problems.push(`the catalog call carried cwd ${String(askedFor?.params?.cwd)}`);
  }

  rig.history = [noteOf(entries)];
  const steady = rig.run({ session_id: "p2", cwd: "E:\\proj", input: "again" }, [rig.scripted("ok")]);
  await steady.done;
  if (catalogNotes(rig.saves.at(-1)).length !== 1) {
    problems.push(`an unchanged catalog appended ${catalogNotes(rig.saves.at(-1)).length - 1} notes`);
  }

  rig.catalog = { complete: true, entries: [{ name: "s", description: "moved" }], text: "catalog text two" };
  const moved = rig.run({ session_id: "p3", cwd: "E:\\proj", input: "again" }, [rig.scripted("ok")]);
  await moved.done;
  const movedNotes = catalogNotes(rig.saves.at(-1));
  if (movedNotes.length !== 2) problems.push(`a moved catalog kept ${movedNotes.length} notes`);
  if ((movedNotes[1]?.source as { update?: unknown } | undefined)?.update !== true) {
    problems.push("a replacement note was not marked as an update");
  }

  rig.catalog = { complete: false, entries: [{ name: "s", description: "moved" }], text: "catalog text three" };
  rig.history = [noteOf(entries)];
  const partial = rig.run({ session_id: "p4", cwd: "E:\\proj", input: "again" }, [rig.scripted("ok")]);
  await partial.done;
  if (catalogNotes(rig.saves.at(-1)).length !== 1) {
    problems.push("an incomplete catalog read rewrote the model's view");
  }

  rig.catalog = { complete: true, entries: [], text: "<available_skills>\n</available_skills>" };
  const emptied = rig.run({ session_id: "p5", cwd: "E:\\proj", input: "again" }, [rig.scripted("ok")]);
  await emptied.done;
  const emptiedNotes = catalogNotes(rig.saves.at(-1));
  if (emptiedNotes.length !== 2) problems.push("an emptied catalog did not replace the previous note");
  if (((emptiedNotes[1]?.source as { entries?: unknown[] } | undefined)?.entries ?? [null]).length !== 0) {
    problems.push("the empty replacement carried entries");
  }
  const orphan = rig.run(
    {
      session_id: "sub-d",
      cwd: "E:\\proj",
      input: "child",
      origin: { parent_session_id: "p1", parent_call_id: "c3", type: "general", description: "child" },
    },
    [rig.scripted("child done")],
  );
  await orphan.done;
  if (orphan.chat[0]?.model !== undefined) {
    problems.push(`a subagent outlived its parent's level: ${JSON.stringify(orphan.chat[0]?.model)}`);
  }

  for (const [bad, why] of [
    [{ session_id: "s", origin: {} }, "an origin without a parent"],
    [{ session_id: "s", origin: { parent_session_id: "" } }, "a blank parent session"],
    [{ session_id: "s", origin: 7 }, "a non-object origin"],
    [{ session_id: "s", tools_allow: "read" }, "a non-array allow list"],
    [{ session_id: "s", tools_allow: ["read", 7] }, "an allow list with a non-name"],
    [{ session_id: "s", max_steps: 0 }, "a zero step budget"],
    [{ session_id: "s", system: 7 }, "a non-string system prompt"],
  ] as Array<[Record<string, unknown>, string]>) {
    try {
      await rig.run(bad, []).done;
      problems.push(`run accepted ${why}`);
    } catch {
    }
  }

  if (hasOpinion({})) problems.push("an empty hook outcome counted as an opinion");
  if (!hasOpinion({ context: [] })) problems.push("a bare context is still an opinion");
  if ("steer" in asPreTool({ decision: "deny", reason: "no", steer: "again" })) {
    problems.push("a pre-tool decision kept a field its seam does not consume");
  }
  const refused = asPostTool({ decision: "deny", reason: "no" });
  if (refused.halt !== true) problems.push("a post-tool refusal did not end the round");
  if ((refused.context ?? []).map((note) => `${note.source}:${note.text}`).join(",") !== `${DENIED}:no`) {
    problems.push(`a post-tool refusal came out as ${JSON.stringify(refused.context)}`);
  }
  const steering = asStop({ steer: "again", context: [{ source: "hook:x", text: "t" }] });
  if (steering.steer !== "again" || steering.context?.length !== 1) problems.push("a stop decision drifted");
}
