/// The loop runs the self check drives: the hook engine that must never turn
/// into a decision the loop did not ask for, the context an event with no seam
/// contributes, the tool result that changes the run it came back to, the fork
/// that keeps only its last words, the fold, the step ceiling, a model that
/// fails and the delegation depth. Everything here goes through the rig in
/// `selfcheck-rig.ts`.

import type { Call, Definition, Wiring } from "@maota/plugin-kit";
import { runLoop, type Message, type ToolSpec } from "@maota/agent-loop";
import { LEVELS } from "./levels.ts";
import { hooksOn, triggerHook } from "./hooks.ts";
import type { Rig } from "./selfcheck-rig.ts";

export async function checkLoopRuns(definition: Definition, rig: Rig, problems: string[]): Promise<void> {
  let engine = 0;
  const logged: string[] = [];
  const fakeEngine = (reply: unknown, fail = false): Wiring =>
    ({
      config: {},
      capabilities: { hooks: { plugin: "hooks" } },
      channel: {
        call: async () => {
          engine += 1;
          if (fail) throw new Error("engine down");
          return reply;
        },
        log: (level: string, message: string) => logged.push(`${level}: ${message}`),
      },
    }) as unknown as Wiring;
  const engineOff = { config: {}, capabilities: {}, channel: fakeEngine(null).channel } as unknown as Wiring;

  await definition.start?.(engineOff);
  if (Object.keys(await triggerHook(engineOff as unknown as Call, "Stop", {})).length !== 0) {
    problems.push("an opinion was invented while the engine was off");
  }
  if (engine !== 0) problems.push("the engine was called while it was off");

  await definition.start?.(fakeEngine({ decision: "deny", reason: "no" }));
  const heard = await triggerHook(fakeEngine({ decision: "deny", reason: "no" }) as unknown as Call, "PreToolUse", {});
  if (heard.reason !== "no" || heard.decision !== "deny") {
    problems.push(`the engine's answer did not reach the seam: ${JSON.stringify(heard)}`);
  }
  if (Object.keys(await triggerHook(fakeEngine(null, true) as unknown as Call, "Stop", {})).length !== 0) {
    problems.push("a failed engine call invented an opinion");
  }
  if (!logged.some((line) => line.startsWith("warn: "))) problems.push("a failed engine call was not logged");
  await definition.start?.(engineOff);
  if (hooksOn()) problems.push("the seam stayed on once the capability went away");

  /// An event the loop has no seam for is not a dead letter: what it says is
  /// written into the turn, so the model it was meant for still reads it.
  await definition.start?.(fakeEngine({}));
  rig.hookAnswer = (params) =>
    params?.event === "SessionStart" ? { context: [{ source: "hook:loud", text: "remember this" }] } : {};
  const noted = rig.run({ session_id: "noted", cwd: "E:\\proj", input: "hello" }, [rig.scripted("done")]);
  await noted.done;
  rig.hookAnswer = () => ({});
  await definition.start?.(engineOff);
  const written = (rig.saves.at(-1)?.messages ?? []) as Message[];
  if (!written.some((message) => message.name === "hook:loud" && message.content === "remember this")) {
    problems.push(`a hook that spoke at SessionStart was not written into the turn: ${JSON.stringify(written)}`);
  }

  const info = definition.methods.info?.({}, {} as Call) as { levels?: string[]; thinking?: unknown } | undefined;
  if (info?.levels?.join(",") !== LEVELS.join(",")) problems.push(`info returned ${JSON.stringify(info)}`);

  let asked = 0;
  const deltas: string[] = [];
  const messages: Message[] = [{ role: "system", content: "s" }, { role: "user", content: "hi" }];
  const outcome = await runLoop(
    {
      tools: [],
      max_steps: 4,
      chat: async (step) => {
        asked += 1;
        if (asked === 1) {
          step.delta({ text: "→" });
          step.delta({ reasoning: "plan" });
          return {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "c1", function: { name: "echo", arguments: '{"n":1}' } }],
          };
        }
        step.delta({ text: "done" });
        return { role: "assistant", content: "done" };
      },
      callTool: async (call) => ({ name: call.name, args: call.args }),
    },
    messages,
    new AbortController().signal,
    (event) => {
      if (event.type === "text") deltas.push(event.text);
    },
  );
  if (outcome.text !== "done") problems.push(`loop text ${JSON.stringify(outcome.text)}`);
  if (outcome.steps !== 2) problems.push(`loop took ${outcome.steps} steps, expected 2`);
  if (outcome.reason !== "completed") problems.push(`loop ended as ${outcome.reason}, expected completed`);
  if (!messages.some((message) => message.role === "tool")) problems.push("loop never wrote a tool result back");
  if (deltas.join("") !== "→done") problems.push(`deltas came out as ${JSON.stringify(deltas)}`);

  /// A tool result may ask the run to change, and the run applies it without
  /// knowing which tool asked: the narrowing, the model and the hooks all come
  /// off one `control` field on the result.
  {
    const seen: Array<{ tools?: ToolSpec[]; model?: string }> = [];
    const hookCalls: Array<{ method: string; params: any }> = [];
    const answers = [
      { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "skill", arguments: "{}" } }] },
      { role: "assistant", content: "done" },
    ];
    const calls2: Message[] = [{ role: "user", content: "go" }];
    const saves2: Array<Record<string, any>> = [];
    definition.start?.({
      channel: { log: (): void => {} },
      config: {},
      capabilities: { hooks: { plugin: "@maota/hooks-native" } },
    } as unknown as Wiring);
    const call = {
      channel: {
        call: async (capability: string, method: string, params: any) => {
          if (capability === "tools" && method === "list") {
            return {
              tools: [
                { name: "read", description: "read" },
                { name: "write", description: "write" },
                { name: "skill", description: "load a skill" },
              ],
            };
          }
          if (capability === "tools" && method === "classify") return { safe: true };
          if (capability === "tools" && method === "call") {
            return {
              content: "the instructions",
              control: {
                tools_allow: ["read"],
                model: "small",
                hooks: [{ event: "PreToolUse", command: "guard.ps1" }],
              },
            };
          }
          if (capability === "session" && method === "load") return { messages: calls2 };
          if (capability === "session" && method === "save") {
            saves2.push(params);
            return {};
          }
          if (capability === "hooks" && (method === "register" || method === "unregister")) {
            hookCalls.push({ method, params });
            return {};
          }
          if (capability === "system-prompt" && method === "assemble") return { text: "the harness speaks first" };
          throw new Error(`unexpected call ${capability}/${method}`);
        },
        stream: async (_capability: string, _method: string, params: any) => {
          seen.push(params);
          const message = answers.shift() ?? { role: "assistant", content: "done" };
          return { async *[Symbol.asyncIterator]() { yield { type: "message", message }; } };
        },
        log: () => {},
      },
      config: {},
      capabilities: {},
      capability: "agent.loop",
      method: "run",
      signal: new AbortController().signal,
      stream: { push: () => {} },
    } as unknown as Call;
    await definition.methods.run?.({ session_id: "ctrl", cwd: "E:\\proj", input: "go" }, call);
    if ((seen[0]?.tools ?? []).map((tool) => tool.name).join(",") !== "read,write,skill") {
      problems.push(`the first step listed ${rig.surfaced(seen)}`);
    }
    if (seen[0]?.model !== undefined) problems.push("an unrelated run picked up a model on its own");
    if ((seen[1]?.tools ?? []).map((tool) => tool.name).join(",") !== "read") {
      problems.push(`the narrowed step listed ${rig.surfaced(seen)}`);
    }
    if (seen[1]?.model !== "small") problems.push(`the narrowed step asked for ${String(seen[1]?.model)}`);
    const saved = (saves2.at(-1)?.messages ?? []) as Message[];
    const result = saved.find((message) => message.role === "tool");
    if (result?.content !== "the instructions") {
      problems.push(`the model read ${JSON.stringify(result?.content)}`);
    }
    if (hookCalls.map((entry) => entry.method).join(",") !== "register,unregister") {
      problems.push(`the skill hooks were ${hookCalls.map((entry) => entry.method).join(",") || "never touched"}`);
    }
    if (hookCalls[0]?.params?.scope !== "ctrl:c1") {
      problems.push(`the hooks were scoped as ${String(hookCalls[0]?.params?.scope)}`);
    }
    if (hookCalls[0]?.params?.hooks?.[0]?.command !== "guard.ps1") {
      problems.push("the hook the tool brought was not handed over");
    }
  }

  /// `context: fork` runs the body on its own and brings back only its last
  /// words: the call that asked gets a result rather than a transcript.
  {
    const opened: Array<{ origin?: { type?: string }; tools_deny?: string[]; input?: string }> = [];
    const saves3: Array<Record<string, any>> = [];
    const answers = [
      { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "skill", arguments: "{}" } }] },
      { role: "assistant", content: "done" },
    ];
    const call = {
      channel: {
        call: async (capability: string, method: string, params: any) => {
          if (capability === "tools" && method === "list") {
            return { tools: [{ name: "skill", description: "load a skill" }] };
          }
          if (capability === "tools" && method === "classify") return { safe: true };
          if (capability === "tools" && method === "call") {
            return { content: "review this", control: { context: "fork" } };
          }
          if (capability === "session" && method === "load") return { messages: [{ role: "user", content: "go" }] };
          if (capability === "session" && method === "save") {
            saves3.push(params as Record<string, any>);
            return {};
          }
          if (capability === "system-prompt" && method === "assemble") return { text: "the harness speaks first" };
          throw new Error(`unexpected call ${capability}/${method}`);
        },
        stream: async (_capability: string, _method: string, params: any) => {
          if (params.origin !== undefined) {
            opened.push(params);
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "done", steps: 2, text: "the review", reason: "completed" };
              },
            };
          }
          const message = answers.shift() ?? { role: "assistant", content: "done" };
          return { async *[Symbol.asyncIterator]() { yield { type: "message", message }; } };
        },
        log: () => {},
      },
      config: {},
      capabilities: {},
      capability: "agent.loop",
      method: "run",
      signal: new AbortController().signal,
      stream: { push: () => {} },
    } as unknown as Call;
    await definition.methods.run?.({ session_id: "fork", cwd: "E:\\proj", input: "go" }, call);
    if (opened.length !== 1) problems.push(`a forked body opened ${opened.length} child runs`);
    if (opened[0]?.origin?.type !== "skill") problems.push(`a forked body opened as ${String(opened[0]?.origin?.type)}`);
    if ((opened[0]?.tools_deny ?? []).join(",") !== "skill") {
      problems.push("a forked body could reach for the skill tool again");
    }
    if (opened[0]?.input !== "review this") problems.push(`the child was handed ${JSON.stringify(opened[0]?.input)}`);
    const forked = ((saves3.at(-1)?.messages ?? []) as Message[]).find((message) => message.role === "tool");
    if (forked?.content !== "the review") problems.push(`the fork wrote back ${JSON.stringify(forked?.content)}`);
  }

  /// A long history is folded once before the turn runs, and the folded form is
  /// what is stored: the next turn reads a note instead of the whole day.
  {
    const quiet = rig.catalog;
    rig.catalog = { complete: true, entries: [], text: "" };
    definition.setup?.({
      channel: undefined,
      config: { compact_after_chars: 200, compact_keep_messages: 2 },
      capabilities: {},
    } as unknown as Wiring);
    rig.history = [
      { role: "user", content: `an old question ${"x".repeat(300)}` },
      { role: "assistant", content: "an old answer" },
      { role: "user", content: "another old question" },
      { role: "assistant", content: "another old answer" },
    ];
    const folded = rig.run({ session_id: "fold", cwd: "E:\\proj", input: "and now" }, [rig.scripted("done")]);
    await folded.done;
    const stored = (rig.saves.at(-1)?.messages ?? []) as Message[];
    if (stored[0]?.name !== "compact" || stored[1]?.role !== "assistant") {
      problems.push(`a folded history opened with ${JSON.stringify(stored.slice(0, 2))}`);
    }
    const note = stored[0]?.source as { kind?: unknown; folded?: unknown } | undefined;
    if (note?.kind !== "compact" || note.folded !== 3) {
      problems.push(`the compact note carried ${JSON.stringify(note)}`);
    }
    if (stored[0]?.content !== "folded note") problems.push("the compact note is not the summary that came back");
    if (stored.length !== 4) {
      problems.push(`a folded history kept ${stored.length} messages, expected the note, the kept pair and the answer`);
    }
    if (!folded.heard.some((item) => item.capability === "api" && item.method === "chat")) {
      problems.push("a fold never asked the model to summarise");
    }
    if (folded.chat.length !== 1) problems.push(`a folded turn ran ${folded.chat.length} steps, expected 1`);
    rig.catalog = quiet;
  }

  /// The step ceiling leaves a note behind, because the next turn has to know
  /// the work is unfinished.
  {
    definition.setup?.({ channel: undefined, config: {}, capabilities: {} } as unknown as Wiring);
    rig.history = [{ role: "user", content: "earlier" }];
    const stalled = rig.run({ session_id: "stall", cwd: "E:\\proj", input: "go", max_steps: 1 }, [
      rig.scripted("", "read"),
    ]);
    await stalled.done;
    const stored = (rig.saves.at(-1)?.messages ?? []) as Message[];
    const last = stored.at(-1);
    if (last?.name !== "agent:max_steps") problems.push(`a stalled turn stored ${JSON.stringify(last?.name)}`);
    if (last?.content?.includes("step ceiling") !== true) {
      problems.push(`the stall note said ${JSON.stringify(last?.content)}`);
    }
    const done = stalled.events.at(-1) as { reason?: unknown } | undefined;
    if (done?.reason !== "max_steps") problems.push(`a stalled turn ended as ${String(done?.reason)}`);
  }

  /// A model call that fails for good ends the turn as `model_error` instead of
  /// crashing the run, and what the turn had is still saved. The failure itself
  /// is reported as facts, not as prose, because a reader has to be able to
  /// tell a rate limit from a context overflow without reading a sentence.
  {
    const broken = rig.run({ session_id: "boom", cwd: "E:\\proj", input: "hi" }, [], undefined, true);
    await broken.done;
    const done = broken.events.at(-1) as
      | { type?: unknown; reason?: unknown; text?: unknown; failure?: { kind?: unknown; message?: unknown } }
      | undefined;
    if (done?.type !== "done" || done.reason !== "model_error") {
      problems.push(`a failed model call ended as ${JSON.stringify(done)}`);
    }
    if (done?.failure?.message !== "the upstream broke") {
      problems.push(`the failure carried ${JSON.stringify(done?.failure)}`);
    }
    if (typeof done?.failure?.kind !== "string" || done.failure.kind === "") {
      problems.push(`the failure was reported without a kind: ${JSON.stringify(done?.failure)}`);
    }
    if (done?.text !== "") problems.push(`a failed model call still wrote ${JSON.stringify(done?.text)}`);
    if (rig.saves.at(-1)?.id !== "boom") problems.push("a failed turn was not saved");
  }

  /// A retry is not a second answer to one question: what the replaced attempt
  /// already said is taken back, the attempt count is not charged twice, and the
  /// turn ends on the answer the replacement produced. The replacement itself is
  /// the adapter's decision, so it arrives as the two chunks a real adapter
  /// sends rather than as a question the run was asked.
  {
    rig.retries = 1;
    const flaky = rig.run(
      { session_id: "flaky", cwd: "E:\proj", input: "hi" },
      [rig.scripted("second try")],
      undefined,
      1,
    );
    await flaky.done;
    rig.retries = 0;
    const retracted = flaky.events.find((event) => event.type === "retract");
    if (retracted === undefined || retracted.reason !== "transport") {
      problems.push(`a retried attempt was taken back as ${JSON.stringify(retracted)}`);
    }
    if (flaky.chat.length !== 1) problems.push(`a retried turn made ${flaky.chat.length} model calls, expected 1`);
    const seen = flaky.chat[0]?.messages ?? [];
    if (seen.some((message) => message.name === "recovery:model")) {
      problems.push("a plain retry steered the model it was retrying");
    }
    const done = flaky.events.at(-1) as { reason?: unknown; steps?: unknown; text?: unknown } | undefined;
    if (done?.reason !== "completed" || done?.text !== "second try") {
      problems.push(`a recovered turn ended as ${JSON.stringify(done)}`);
    }
    if (done?.steps !== 1) problems.push(`a recovered turn took ${String(done?.steps)} steps, expected 1`);
  }

  /// A request that no longer fits is answered by folding the older half and
  /// asking again, with a note that says how to read what the attempt now
  /// holds. The same request is never sent twice: the folding budget is spent
  /// once, and a conversation with nothing foldable is given up on instead.
  {
    definition.setup?.({
      channel: undefined,
      config: { compact_keep_messages: 2 },
      capabilities: {},
    } as unknown as Wiring);
    rig.failCode = -32056;
    rig.history = [
      { role: "user", content: "an old question" },
      { role: "assistant", content: "an old answer" },
      { role: "user", content: "another old question" },
      { role: "assistant", content: "another old answer" },
    ];
    const overflowed = rig.run(
      { session_id: "overflow", cwd: "E:\proj", input: "and now" },
      [rig.scripted("done")],
      undefined,
      1,
    );
    await overflowed.done;
    if (overflowed.chat.length !== 2) {
      problems.push(`an overflowing turn made ${overflowed.chat.length} model calls, expected 2`);
    }
    const retried: readonly Message[] = overflowed.chat[1]?.messages ?? [];
    if (!retried.some((message) => message.name === "compact" && message.content === "folded note")) {
      problems.push(`the overflowing retry was not given the fold: ${JSON.stringify(retried)}`);
    }
    if (!retried.some((message) => message.name === "recovery:model" && message.content?.includes("context window"))) {
      problems.push(`the overflowing retry was not told how to read the fold: ${JSON.stringify(retried)}`);
    }
    if (!overflowed.heard.some((item) => item.capability === "api" && item.method === "chat")) {
      problems.push("an overflowing turn never asked for a fold");
    }
    const retracted = overflowed.events.find((event) => event.type === "retract");
    if (retracted === undefined || retracted.reason !== "context_window") {
      problems.push(`an overflowing attempt was taken back as ${JSON.stringify(retracted)}`);
    }
    const done = overflowed.events.at(-1) as { reason?: unknown; text?: unknown } | undefined;
    if (done?.reason !== "completed" || done?.text !== "done") {
      problems.push(`a folded retry ended as ${JSON.stringify(done)}`);
    }

    // The folding budget belongs to the run, so a deployment that turns it off
    // never folds: the overflow it was given is the answer it reports.
    definition.setup?.({
      channel: undefined,
      config: { compact_keep_messages: 2, context_compact: false },
      capabilities: {},
    } as unknown as Wiring);
    const off = rig.run(
      { session_id: "no-compact", cwd: "E:\\proj", input: "and now" },
      [rig.scripted("done")],
      undefined,
      1,
    );
    await off.done;
    const refusedFold = off.events.at(-1) as { reason?: unknown; failure?: { kind?: unknown } } | undefined;
    if (refusedFold?.reason !== "model_error" || refusedFold?.failure?.kind !== "context_window") {
      problems.push(`a turn with folding off ended as ${JSON.stringify(refusedFold)}`);
    }
    if (off.heard.some((item) => item.capability === "api" && item.method === "chat")) {
      problems.push("a turn with folding off still asked for a fold");
    }
    definition.setup?.({
      channel: undefined,
      config: { compact_keep_messages: 2 },
      capabilities: {},
    } as unknown as Wiring);

    rig.history = [{ role: "user", content: "nothing to fold here" }];
    const stuck = rig.run({ session_id: "unfoldable", cwd: "E:\\proj", input: "and now" }, [], undefined, true);
    await stuck.done;
    const gaveUp = stuck.events.at(-1) as { reason?: unknown; failure?: { kind?: unknown } } | undefined;
    if (gaveUp?.reason !== "model_error" || gaveUp?.failure?.kind !== "context_window") {
      problems.push(`an unfoldable overflow ended as ${JSON.stringify(gaveUp)}`);
    }
    if (stuck.heard.some((item) => item.capability === "api" && item.method === "chat")) {
      problems.push("a conversation with nothing to fold still asked for a fold");
    }
    rig.failCode = -32053;
    rig.history = [{ role: "user", content: "earlier" }];
  }

  /// Depth is counted, not guessed: a child of the session that is running is
  /// one deeper, and a deployment that sets a ceiling is obeyed.
  {
    definition.setup?.({ channel: undefined, config: { max_depth: 1 }, capabilities: {} } as unknown as Wiring);
    const direct = rig.run({ session_id: "deep", cwd: "E:\\proj", input: "x", depth: 2 }, [rig.scripted("done")]);
    await direct.done;
    const refused = direct.events.at(-1) as { reason?: unknown } | undefined;
    if (refused?.reason !== "refused") problems.push(`a run past max_depth ended as ${String(refused?.reason)}`);
    if (direct.chat.length !== 0) problems.push("a run past max_depth still called the model");

    definition.setup?.({ channel: undefined, config: { max_depth: 0 }, capabilities: {} } as unknown as Wiring);
    const child = rig.run(
      {
        session_id: "kid",
        cwd: "E:\\proj",
        input: "x",
        origin: { parent_session_id: "p9", parent_call_id: "c9" },
      },
      [rig.scripted("done")],
    );
    await child.done;
    const childDone = child.events.at(-1) as { reason?: unknown } | undefined;
    if (childDone?.reason !== "refused") {
      problems.push(`a child past max_depth ended as ${String(childDone?.reason)}`);
    }
    definition.setup?.({ channel: undefined, config: {}, capabilities: {} } as unknown as Wiring);
  }
}
