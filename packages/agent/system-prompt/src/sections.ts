import { SECTION_ORDERS, type PromptFacts, type SectionInput, type VariableInput } from "./registry.ts";

export const DEFAULTS = {
  persona:
    "Use read, glob and edit for files, and pwsh to run commands; do not guess, and do not reach " +
    "for Unix commands such as tail or sed. Answer in the user's language, briefly.",
};

/// The one line the harness owns and a deployment is not meant to rewrite: a
/// model that does not know which harness is answering it guesses at its tools.
export const HARNESS = "You are MaoTa's coding assistant, running on Windows.";

export function approvalText(mode: string | null): string {
  if (mode === "ask") {
    return (
      "approval: ask. A command pwsh flags as destructive waits for the user's decision, " +
      "and is refused when nobody can answer; a refusal is final, so do not retry it."
    );
  }
  if (mode === "auto") return "approval: auto. A command pwsh flags as destructive is approved without asking.";
  if (mode === "full") return "approval: full. Commands run without asking.";
  return "";
}

export interface Builtins {
  sections: SectionInput[];
  variables: VariableInput[];
}

/// What the harness always has to say, in the order it has to say it. The facts
/// arrive per turn, so a section that nothing can fill says nothing: a
/// deployment without a working directory or a permission layer reads one
/// paragraph shorter rather than one paragraph of nothing.
export function builtins(persona: string): Builtins {
  return {
    sections: [
      { name: "harness", order: SECTION_ORDERS.HARNESS, text: HARNESS, interpolate: false },
      {
        name: "persona",
        order: SECTION_ORDERS.PERSONA,
        text: (facts: PromptFacts) => facts.persona ?? persona,
        interpolate: false,
      },
      {
        name: "working-directory",
        order: SECTION_ORDERS.WORKING_DIRECTORY,
        text: (facts: PromptFacts) => (facts.cwd === null ? "" : "working directory: {{cwd}}"),
      },
      { name: "approval", order: SECTION_ORDERS.APPROVAL, text: (facts: PromptFacts) => approvalText(facts.approval) },
    ],
    variables: [
      { name: "session_id", value: (facts: PromptFacts) => facts.session_id },
      { name: "cwd", value: (facts: PromptFacts) => facts.cwd ?? "" },
    ],
  };
}
