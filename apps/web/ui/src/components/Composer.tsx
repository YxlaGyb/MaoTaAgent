import { useState } from "react";
import { MaoButton, MaoTextArea } from "maotaui";

import { useT } from "../lib/i18n.ts";
import type { AppInfo, ContextView, ModelRoute } from "../lib/rpc.ts";
import { ContextMeter } from "./ContextMeter.tsx";
import { Icon, ICON } from "./Icon.tsx";
import { PermissionPicker } from "./PermissionPicker.tsx";
import { SkillPicker } from "./SkillPicker.tsx";
import { ThinkingPicker } from "./ThinkingPicker.tsx";

export function Composer({
  info,
  cwd,
  thinking,
  modelRoute,
  permission,
  permissionDisabled,
  running,
  blocked,
  context,
  onThinking,
  onModelRoute,
  onPermission,
  onCompact,
  onSend,
  onCancel,
}: {
  info: AppInfo | null;
  cwd: string;
  thinking: string;
  modelRoute: ModelRoute | null;
  permission: string;
  permissionDisabled: boolean;
  running: boolean;
  blocked: boolean;
  context: ContextView | null;
  onThinking: (level: string) => void;
  onModelRoute: (route: ModelRoute | null) => void;
  onPermission: (mode: string) => void;
  onCompact: () => void;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const hasModel = (info?.models?.models ?? []).some((model) =>
    model.enabled && (info?.models?.providers.find((item) => item.id === model.provider)?.enabled ?? true));
  const [text, setText] = useState("");

  const submit = (): void => {
    if (running || blocked || !hasModel || text.trim() === "") return;
    onSend(text);
    setText("");
  };

  /// A reference rather than the instructions, so the sentence stays readable
  /// and the model still does the loading.
  const reference = (name: string): void => {
    setText((was) => {
      const line = `Use the "${name}" skill.`;
      return was.trim() === "" ? line : `${was.replace(/\s+$/, "")}\n${line}`;
    });
  };

  return (
    <div className="composer">
      <MaoTextArea
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
        <SkillPicker cwd={cwd} disabled={blocked || info?.capabilities?.skill === undefined} onPick={reference} />
        <PermissionPicker
          value={permission}
          disabled={blocked || permissionDisabled}
          note={info?.capabilities?.permission === undefined ? t("permissionOff") : undefined}
          onChange={onPermission}
        />
        <ContextMeter context={context} running={running} onCompact={onCompact} />
        <ThinkingPicker info={info} thinking={thinking} modelRoute={modelRoute} disabled={blocked} onThinking={onThinking} onModelRoute={onModelRoute} />
        {running ? (
          <MaoButton className="composer-send" aria-label={t("stop")} onClick={onCancel}>
            <Icon name={ICON.square} size={12} />
          </MaoButton>
        ) : (
          <MaoButton
            className="composer-send"
            aria-label={t("send")}
            disabled={blocked || !hasModel || text.trim() === ""}
            onClick={submit}
          >
            <Icon name={ICON.arrowUp} size={16} />
          </MaoButton>
        )}
      </div>
    </div>
  );
}
