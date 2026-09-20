export interface PluginRow {
  id: string;
  name: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
}

export const rows: PluginRow[] = [
  { id: "api", name: "@maota/api" },
  { id: "shell", name: "@maota/shell" },
  { id: "tools", name: "@maota/tools" },
  { id: "skill", name: "@maota/skill" },
  { id: "skill-filesystem", name: "@maota/skill-filesystem" },
  { id: "session", name: "@maota/session" },
  { id: "agent-core", name: "@maota/agent-core" },
  { id: "hmr", name: "@maota/hmr", disabled: true },
];
