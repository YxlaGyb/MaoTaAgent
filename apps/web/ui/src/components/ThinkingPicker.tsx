import { useState } from "react";

import { useLang, useT } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

const THINKING_LABEL: Record<string, Record<string, string>> = {
  "zh-CN": { off: "关", low: "低", medium: "中", high: "高" },
  en: { off: "Off", low: "Low", medium: "Medium", high: "High" },
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
  const lang = useLang();
  const t = useT();
  const [open, setOpen] = useState(false);
  const levels = info?.levels?.length ? info.levels : ["off", "low", "medium", "high"];
  const name = (level: string): string => THINKING_LABEL[lang]?.[level] ?? level;

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
        <button
          type="button"
          className="popover-reset"
          title={t("reset")}
          aria-label={t("reset")}
          onClick={() => onChange(levels[0] ?? "off")}
        >
          <Icon d={ICON.reset} className="icon icon-sm" />
        </button>
      </div>
      <div className="level-now">{name(value)}</div>
      <div className="level-slider">
        <span className="level-track" />
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            className={`level-dot${level === value ? " is-on" : ""}`}
            title={name(level)}
            aria-label={name(level)}
            aria-pressed={level === value}
            onClick={() => onChange(level)}
          />
        ))}
      </div>
    </Popover>
  );
}
