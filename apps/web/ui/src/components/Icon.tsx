import { MaoIcon, type IconName } from "maotaui";

export const ICON = {
  chat: "chat",
  clock: "clock",
  plug: "plug",
  folder: "folder",
  folderOpen: "folderOpen",
  plus: "plus",
  sliders: "sliders",
  bulb: "bulb",
  hand: "hand",
  shield: "shield",
  alert: "alert",
  check: "check",
  back: "back",
  search: "search",
  close: "close",
  art: "palette",
  palette: "palette",
  chevronDown: "chevronDown",
  chevronRight: "chevronRight",
  more: "more",
  pin: "pin",
  archive: "archive",
  restore: "restore",
  arrowUp: "arrowUp",
  square: "square",
  cpu: "cpu",
} as const satisfies Record<string, IconName>;

export const Icon = MaoIcon;
export type { IconName };
