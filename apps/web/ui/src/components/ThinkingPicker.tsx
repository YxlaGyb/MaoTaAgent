import { useState } from "react";

import { useT, type MessageKey } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

/// A level the model may be asked to think at, named through the dictionary
/// rather than by the level id, so a level nobody wrote words for shows its own
/// name instead of disappearing from the menu.
const LEVEL_KEY: Record<string, MessageKey> = {
  off: "thinkingOff",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
};

export function ThinkingPicker({
  info,
  value,
  onChange,
  disabled,
}: {
  info: AppInfo | null;
  value: string;
  onChange: (level: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const levels = info?.levels?.length ? info.levels : ["off", "low", "medium", "high"];
  const name = (level: string): string => {
    const key = LEVEL_KEY[level];
    return key === undefined ? level : t(key);
  };

  return (
    <Popover
      align="end"
      className="thinking"
      title={t("thinking")}
      open={open}
      disabled={disabled}
      onToggle={() => setOpen((was) => !was)}
      onClose={() => setOpen(false)}
      label={
        <>
          <Icon d={ICON.bulb} className="icon icon-sm" />
          {name(value)}
        </>
      }
    >
      <div className="popover-head">
        <span>{t("thinking")}</span>
      </div>
      {levels.map((level) => (
        <button
          key={level}
          type="button"
          className={`option${level === value ? " is-on" : ""}`}
          aria-pressed={level === value}
          onClick={() => {
            onChange(level);
            setOpen(false);
          }}
        >
          <span className="option-text">
            <span className="option-name">{name(level)}</span>
          </span>
          {level === value ? <Icon d={ICON.check} className="icon icon-sm option-check" /> : null}
        </button>
      ))}
    </Popover>
  );
}
