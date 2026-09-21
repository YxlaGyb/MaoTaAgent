export interface PluginRow {
  id: string;
  name: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
}

export const rows: PluginRow[] = [
  { id: "api", name: "@maota/api" },
  { id: "pwsh-local", name: "@maota/pwsh-local" },
  { id: "permission", name: "@maota/permission" },
  { id: "tool-pwsh", name: "@maota/tool-pwsh" },
  { id: "tool-fs", name: "@maota/tool-fs" },
  { id: "tool-fs-search", name: "@maota/tool-fs-search" },
  { id: "tools", name: "@maota/tools" },
  { id: "skill", name: "@maota/skill" },
  { id: "skill-filesystem", name: "@maota/skill-filesystem" },
  { id: "session", name: "@maota/session" },
  { id: "hooks", name: "@maota/hooks-native" },
  { id: "agent-core", name: "@maota/agent-core" },
  { id: "hmr", name: "@maota/hmr", disabled: true },
];
