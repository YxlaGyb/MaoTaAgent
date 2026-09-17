import { useState } from "react";
import { MaoButton, TextArea } from "maotaui";

import { useT } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";
import { PermissionPicker } from "./PermissionPicker.tsx";
import { ThinkingPicker } from "./ThinkingPicker.tsx";

function SendIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 12.5V3.5M4.5 7L8 3.5L11.5 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="2" />
    </svg>
  );
}

export function Composer({
  info,
  thinking,
  permission,
  running,
  blocked,
  onThinking,
  onPermission,
  onSend,
  onCancel,
}: {
  info: AppInfo | null;
  thinking: string;
  permission: string;
  running: boolean;
  blocked: boolean;
  onThinking: (level: string) => void;
  onPermission: (mode: string) => void;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");

  const submit = (): void => {
    if (running || blocked || text.trim() === "") return;
    onSend(text);
    setText("");
  };

  return (
    <div className="composer">
      <TextArea
        className="composer-text"
        rows={2}
        placeholder={t("inputPlaceholder")}
        value={text}
        disabled={running || blocked}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-row">
        <PermissionPicker value={permission} disabled={blocked} onChange={onPermission} />
        <ThinkingPicker info={info} value={thinking} disabled={blocked} onChange={onThinking} />
        {running ? (
          <MaoButton className="composer-send" aria-label={t("stop")} onClick={onCancel}>
            <StopIcon />
          </MaoButton>
        ) : (
          <MaoButton
            className="composer-send"
            aria-label={t("send")}
            disabled={blocked || text.trim() === ""}
            onClick={submit}
          >
            <SendIcon />
          </MaoButton>
        )}
      </div>
    </div>
  );
}
