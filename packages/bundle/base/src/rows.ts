export interface PluginRow {
  id: string;
  name: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
}

export const rows: PluginRow[] = [
  { id: "api", name: "@maota/api" },
  { id: "i18n", name: "@maota/i18n-native" },
  { id: "pwsh-local", name: "@maota/pwsh-local" },
  { id: "permission", name: "@maota/permission" },
  { id: "tool-pwsh", name: "@maota/tool-pwsh" },
  { id: "tool-fs", name: "@maota/tool-fs" },
  { id: "tool-fs-search", name: "@maota/tool-fs-search" },
  { id: "tool-todo", name: "@maota/tool-todo" },
  { id: "tool-subagent", name: "@maota/tool-subagent" },
  { id: "skill-filesystem", name: "@maota/skill-filesystem" },
  { id: "skill-bundled", name: "@maota/skill-bundled" },
  { id: "skill", name: "@maota/skill" },
  { id: "tool-skill", name: "@maota/tool-skill" },
  { id: "tools", name: "@maota/tools" },
  { id: "session", name: "@maota/session" },
  { id: "hooks", name: "@maota/hooks-native" },
  { id: "system-prompt", name: "@maota/system-prompt" },
  { id: "agent-core", name: "@maota/agent-core" },
  { id: "hmr", name: "@maota/hmr", disabled: true },
];
