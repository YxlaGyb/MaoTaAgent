export interface PluginRow {
  id: string;
  name: string;
  disabled?: boolean;
  config?: Record<string, unknown>;
}

export const rows: PluginRow[] = [
  { id: "web", name: "@maota/web" },
];
