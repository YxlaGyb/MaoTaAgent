import { useState } from "react";

import { useT, type MessageKey } from "../lib/i18n.ts";
import type { AppInfo, ModelRoute } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

const LEVEL_KEY: Record<string, MessageKey> = {
  off: "thinkingOff",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
};

export function ThinkingPicker({
  info,
  thinking,
  modelRoute,
  disabled,
  onThinking,
  onModelRoute,
}: {
  info: AppInfo | null;
  thinking: string;
  modelRoute: ModelRoute | null;
  disabled?: boolean;
  onThinking: (level: string) => void;
  onModelRoute: (route: ModelRoute | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "model" | "reasoning">("root");
  const levels = info?.levels?.length ? info.levels : ["off", "low", "medium", "high"];
  const providers = info?.models?.providers ?? [];
  const models = (info?.models?.models ?? []).filter((model) =>
    model.enabled && (providers.find((item) => item.id === model.provider)?.enabled ?? true));
  const route = modelRoute ?? info?.models?.default_route ?? null;
  const selected = route === null ? null : models.find((model) => model.provider === route.provider && model.model === route.model) ?? null;
  const provider = route === null ? null : providers.find((item) => item.id === route.provider) ?? null;
  const modelName = selected?.name ?? provider?.name ?? t("model");
  const showReasoning = selected === null || selected.reasoning_efforts.length > 0;
  const reasoningLevels = selected?.reasoning_efforts.length ? selected.reasoning_efforts : levels;
  const levelName = (level: string): string => {
    const key = LEVEL_KEY[level];
    return key === undefined ? level : t(key);
  };
  const close = (): void => {
    setView("root");
    setOpen(false);
  };

  return (
    <Popover
      align="end"
      className="thinking model-reason-picker"
      title={t("model")}
      open={open}
      disabled={disabled}
      onToggle={() => {
        if (open) close();
        else setOpen(true);
      }}
      onClose={close}
      label={
        <>
          <span className="model-reason-trigger-name">{modelName}</span>
          {showReasoning ? <span className="model-reason-trigger-level">{levelName(thinking)}</span> : null}
          <Icon name={ICON.chevronDown} className="icon icon-sm" />
        </>
      }
    >
      {view === "root" ? (
        <div className="model-reason-rows">
          <button type="button" className="model-reason-row" onClick={() => setView("model")}>
            <span>{t("model")}</span>
            <span className="model-reason-value">{modelName}<Icon name={ICON.chevronRight} className="icon icon-sm" /></span>
          </button>
          {showReasoning ? (
            <button type="button" className="model-reason-row" onClick={() => setView("reasoning")}>
              <span>{t("reasoningLevel")}</span>
              <span className="model-reason-value">{levelName(thinking)}<Icon name={ICON.chevronRight} className="icon icon-sm" /></span>
            </button>
          ) : null}
        </div>
      ) : view === "model" ? (
        <div className="model-reason-menu">
          <button type="button" className="model-reason-back" onClick={() => setView("root")}>
            <Icon name={ICON.back} className="icon icon-sm" />{t("model")}
          </button>
          {models.length === 0 ? <div className="model-reason-empty">{t("modelsEmptyTitle")}</div> : null}
          {providers.map((owner) => {
            const owned = models.filter((model) => model.provider === owner.id);
            if (owned.length === 0) return null;
            return (
              <div key={owner.id} className="model-reason-group">
                {owned.map((model) => {
                  const current = route?.provider === model.provider && route.model === model.model;
                  return (
                    <button
                      key={model.provider + "/" + model.model}
                      type="button"
                      className="option"
                      onClick={() => { onModelRoute({ provider: model.provider, model: model.model }); close(); }}
                    >
                      <span className="option-text"><span className="option-name">{model.name}</span></span>
                      {current ? <Icon name={ICON.check} className="icon icon-sm option-check" /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="model-reason-menu">
          <button type="button" className="model-reason-back" onClick={() => setView("root")}>
            <Icon name={ICON.back} className="icon icon-sm" />{t("reasoningLevel")}
          </button>
          {reasoningLevels.map((level) => (
            <button
              key={level}
              type="button"
              className="option"
              onClick={() => { onThinking(level); close(); }}
            >
              <span className="option-text"><span className="option-name">{levelName(level)}</span></span>
              {level === thinking ? <Icon name={ICON.check} className="icon icon-sm option-check" /> : null}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
