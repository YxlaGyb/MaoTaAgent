/// The main pane: the chat, skills and plugins views, with the search overlay
/// that drops over them. It turns the session list into the chat header's title
/// and the rows the palette searches, then hands everything to the views.

import { useT } from "../lib/i18n.ts";
import type { AppInfo, Approval, SessionMessage, SessionSummary } from "../lib/rpc.ts";
import { ChatView } from "./ChatView.tsx";
import type { LiveTurn } from "./MessageList.tsx";
import { PluginsView } from "./PluginsView.tsx";
import { SearchPalette } from "./SearchPalette.tsx";
import { SkillsView } from "./SkillsView.tsx";

export function MainPane({
  page,
  info,
  kernelError,
  project,
  sessions,
  archived,
  names,
  active,
  lives,
  messages,
  pending,
  failure,
  thinking,
  permission,
  approvals,
  spawned,
  palette,
  onPalette,
  onNew,
  onPickProject,
  onOpen,
  onRetry,
  onKeySaved,
  onThinking,
  onPermission,
  onAnswer,
  onSend,
  onCancel,
}: {
  page: "chat" | "settings" | "plugins" | "skills";
  info: AppInfo | null;
  kernelError: string | null;
  project: string;
  sessions: SessionSummary[];
  archived: string[];
  names: Record<string, string>;
  active: { id: string; cwd: string } | null;
  lives: Record<string, LiveTurn>;
  messages: SessionMessage[];
  pending: string | null;
  failure: { session: string; text: string } | null;
  thinking: string;
  permission: string;
  approvals: Approval[];
  spawned: Record<string, SessionSummary[]>;
  palette: boolean;
  onPalette: (open: boolean) => void;
  onNew: (cwd: string) => void;
  onPickProject: () => void;
  onOpen: (session: SessionSummary) => void;
  onRetry: () => void;
  onKeySaved: () => void;
  onThinking: (value: string) => void;
  onPermission: (mode: string) => void;
  onAnswer: (id: string, decision: "allow" | "deny") => void;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const title = sessions.find((item) => item.id === active?.id)?.title || t("newChat");
  const searchable = sessions.filter((session) => !archived.includes(session.id));

  return (
    <>
      {page === "plugins" ? (
        <PluginsView info={info} />
      ) : page === "skills" ? (
        <SkillsView cwd={project} />
      ) : (
        <ChatView
          info={info}
          kernelError={kernelError}
          session={active}
          title={title}
          messages={messages}
          pending={pending}
          live={active === null ? null : (lives[active.id] ?? null)}
          failure={failure !== null && active !== null && failure.session === active.id ? failure.text : null}
          hasKey={info?.has_key ?? null}
          thinking={thinking}
          permission={permission}
          approvals={approvals}
          spawned={spawned}
          onRetry={onRetry}
          onKeySaved={onKeySaved}
          onThinking={onThinking}
          onPermission={onPermission}
          onAnswer={onAnswer}
          onSend={onSend}
          onCancel={onCancel}
        />
      )}
      {palette ? (
        <SearchPalette
          sessions={searchable}
          names={names}
          onNew={() => {
            onPalette(false);
            onNew(project);
          }}
          onAddProject={() => {
            onPalette(false);
            onPickProject();
          }}
          onPick={(session) => {
            onPalette(false);
            onOpen(session);
          }}
          onClose={() => onPalette(false)}
        />
      ) : null}
    </>
  );
}
