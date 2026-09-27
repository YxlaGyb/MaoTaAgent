import type { Message, SourcedText } from "@maota/agent-loop";

export interface ContextNote extends SourcedText {
  replace?: boolean;
}

export function mergeContextNotes(messages: Message[], notes: readonly ContextNote[]): void {
  for (const note of notes) {
    if (note.text.trim() === "") continue;
    if (note.replace !== true) {
      messages.push({ role: "user", name: note.source, content: note.text });
      continue;
    }
    const indices: number[] = [];
    for (let index = 0; index < messages.length; index += 1) {
      if (messages[index]?.name === note.source) indices.push(index);
    }
    const last = indices.at(-1);
    if (last === undefined) {
      messages.push({ role: "user", name: note.source, content: note.text });
      continue;
    }
    messages[last] = { role: "user", name: note.source, content: note.text };
    for (const index of indices.slice(0, -1).reverse()) messages.splice(index, 1);
  }
}