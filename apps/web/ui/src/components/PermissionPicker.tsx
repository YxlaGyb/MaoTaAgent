import { useState } from "react";

import { useT, type MessageKey } from "../lib/i18n.ts";
import { Icon, ICON } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

export const PERMISSION_OPTIONS: readonly {
  value: string;
  icon: string;
  name: MessageKey;
  note: MessageKey;
  tone: string;
}[] = [
  { value: "ask", icon: ICON.hand, name: "askApproval", note: "askNote", tone: "" },
  { value: "auto", icon: ICON.shield, name: "autoApprove", note: "autoNote", tone: "" },
  { value: "full", icon: ICON.alert, name: "fullAccess", note: "fullNote", tone: " is-danger" },
];

export function PermissionPicker({
  value,
  onChange,
  disabled,
  note,
}: {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
  note?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const current = PERMISSION_OPTIONS.find((option) => option.value === value) ?? PERMISSION_OPTIONS[0]!;

  return (
    <Popover
      className="permission"
      title={t("permission")}
      open={open}
      disabled={disabled}
      onToggle={() => setOpen((was) => !was)}
      onClose={() => setOpen(false)}
      label={
        <>
          <Icon d={current.icon} className="icon icon-sm" />
          {t(current.name)}
        </>
      }
    >
      <div className="popover-head">
        <span>{t("permissionAsk")}</span>
      </div>
      {note === undefined ? null : <div className="popover-note">{note}</div>}
      {PERMISSION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`option${option.value === value ? " is-on" : ""}${option.tone}`}
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
            setOpen(false);
          }}
        >
          <Icon d={option.icon} className="icon option-icon" />
          <span className="option-text">
            <span className="option-name">{t(option.name)}</span>
            <span className="option-note">{t(option.note)}</span>
          </span>
          {option.value === value ? <Icon d={ICON.check} className="icon icon-sm option-check" /> : null}
        </button>
      ))}
    </Popover>
  );
}
