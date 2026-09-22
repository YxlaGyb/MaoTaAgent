import { randomBytes } from "node:crypto";

import { CallError } from "@maota/plugin-kit";

export const TASK_TOOL = "task";

export const SUBAGENT_TYPES = ["general", "explore"] as const;
export type SubagentType = (typeof SUBAGENT_TYPES)[number];

export const DEFAULT_GENERAL_SYSTEM =
  "You are a subagent inside MaoTa, running on Windows. The agent that started you handed you one task, and it " +
  "is the only reader you have: nothing else of your work reaches it, only the message you end with. Do the " +
  "task with the tools you have, check what can be checked, and then answer with the result itself, briefly, in " +
  "the user's language. If the tools you have cannot do it, say that in that final message rather than " +
  "guessing.";

export const DEFAULT_EXPLORE_SYSTEM =
  "You are a read-only subagent inside MaoTa: you can look at the working directory and nothing else. Answer " +
  "the question you were handed by reading what is there, and give the answer with the paths and line numbers " +
  "that prove it. You cannot change anything, so never promise an edit; report what you found, briefly, in the " +
  "user's language.";

export interface PlanSettings {
  explore_tools: readonly string[];
  child_tools_deny: readonly string[];
  general_system: string;
  explore_system: string;
}

export interface ChildPlan {
  tools_allow: string[] | null;
  tools_deny: string[];
  system: string;
}

export function isSubagentType(value: unknown): value is SubagentType {
  return typeof value === "string" && (SUBAGENT_TYPES as readonly string[]).includes(value);
}

export function readSubagentType(value: unknown): SubagentType {
  if (value === undefined || value === null || value === "") return "general";
  if (!isSubagentType(value)) {
    throw new CallError(
      -32602,
      `subagent_type must be one of ${SUBAGENT_TYPES.join(", ")}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/// One level of delegation is the whole shape: a subagent never gets the tool
/// that would start another one, whatever a configuration asks for, and the
/// deployment's own denials are added to that one rather than replacing it.
export function childPlan(type: SubagentType, settings: PlanSettings): ChildPlan {
  const deny = [TASK_TOOL];
  for (const name of settings.child_tools_deny) if (name !== TASK_TOOL) deny.push(name);
  if (type === "explore") {
    return { tools_allow: [...settings.explore_tools], tools_deny: deny, system: settings.explore_system };
  }
  return { tools_allow: null, tools_deny: deny, system: settings.general_system };
}

export function childId(): string {
  return `sub-${randomBytes(6).toString("hex")}`;
}

export function limitRefusal(max: number): string {
  return (
    `${max} subagents are already running, which is the cap, so this call was refused before it started: wait ` +
    "for one of them to finish, or do the work here instead, and do not retry it right away"
  );
}

export function failureRefusal(type: SubagentType, detail: string): string {
  return `the ${type} subagent failed before it answered: ${detail}`;
}

export const PARTIAL = "the subagent stopped at its step limit, so this is a partial answer";

export function subagentResult(text: unknown, reason: string): string {
  const body = typeof text === "string" ? text.trim() : "";
  if (reason === "max_steps") return body === "" ? PARTIAL : `${body}\n\n(${PARTIAL})`;
  return body === "" ? "(the subagent finished without a final message)" : body;
}
