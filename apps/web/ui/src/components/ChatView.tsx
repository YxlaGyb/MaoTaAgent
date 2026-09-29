import { MaoButton } from "maotaui";

import type { AppInfo, Approval, ContextView, ModelRoute, SessionMessage, SessionSummary } from "../lib/rpc.ts";
import { useT } from "../lib/i18n.ts";
import { Composer } from "./Composer.tsx";
import { Icon, ICON } from "./Icon.tsx";
import { MessageList, type LiveTurn } from "./MessageList.tsx";

export function ChatView({
  info,
  kernelError,
  session,
  title,
  messages,
  pending,
  live,
  failure,
  thinking,
  modelRoute,
  permission,
  approvals,
  context,
  onCompact,
  spawned,
  onRetry,
  onThinking,
  onModelRoute,
  onPermission,
  onAnswer,
  onSend,
  onCancel,
}: {
  info: AppInfo | null;
  kernelError: string | null;
  session: { id: string; cwd: string } | null;
  title: string;
  messages: SessionMessage[];
  pending: string | null;
  live: LiveTurn | null;
  failure: string | null;
  hasKey: boolean | null;
  thinking: string;
  modelRoute: ModelRoute | null;
  permission: string;
  approvals: Approval[];
  context: ContextView | null;
  onCompact: () => void;
  spawned: Record<string, SessionSummary[]>;
  onRetry: () => void;
  onThinking: (level: string) => void;
  onModelRoute: (route: ModelRoute | null) => void;
  onPermission: (mode: string) => void;
  onAnswer: (id: string, decision: "allow" | "deny") => void;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const idle = messages.length === 0 && pending === null && live === null;
  const permissionDisabled = session === null || live?.running === true;

  const composer = (
    <Composer
      info={info}
      cwd={session?.cwd ?? ""}
      thinking={thinking}
      modelRoute={modelRoute}
      permission={permission}
      permissionDisabled={permissionDisabled}
      running={live?.running === true}
      blocked={kernelError !== null}
      context={context}
      onThinking={onThinking}
      onModelRoute={onModelRoute}
      onPermission={onPermission}
      onCompact={onCompact}
      onSend={onSend}
      onCancel={onCancel}
    />
  );

  return (
    <main className="chat">
      {session === null ? null : (
        <header className="chat-head">
          <span className="chat-title">{title}</span>
        </header>
      )}

      {kernelError === null ? null : (
        <div className="banner banner-error">
          <Icon name={ICON.alert} className="icon icon-sm" />
          <span>{kernelError}</span>
          <MaoButton variant="ghost" size="sm" onClick={onRetry}>
            {t("retry")}
          </MaoButton>
        </div>
      )}

      {idle ? (
        <div className="chat-hello">
          <div className="hello-box">{composer}</div>
        </div>
      ) : (
        <>
          <MessageList
            messages={messages}
            pending={pending}
            live={live}
            approvals={approvals}
            spawned={spawned}
            cwd={session?.cwd ?? ""}
            onAnswer={onAnswer}
          />
          {failure === null ? null : (
            <div className="banner banner-error">
              <Icon name={ICON.alert} className="icon icon-sm" />
              <span>{failure}</span>
            </div>
          )}
          {composer}
        </>
      )}
    </main>
  );
}
