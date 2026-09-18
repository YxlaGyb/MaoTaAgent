import { useState } from "react";

import { useT } from "../lib/i18n.ts";
import type { SessionSummary } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { projectLabel } from "./Sidebar.tsx";

export function SearchPalette({
  sessions,
  names,
  onPick,
  onNew,
  onAddProject,
  onClose,
}: {
  sessions: SessionSummary[];
  names: Record<string, string>;
  onPick: (session: SessionSummary) => void;
  onNew: () => void;
  onAddProject: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const hits = sessions.filter((session) => `${session.title} ${session.cwd}`.toLowerCase().includes(needle));
  const actions = [
    { key: "new", label: t("newChat"), icon: ICON.chat, run: onNew },
    { key: "folder", label: t("openFolder"), icon: ICON.folder, run: onAddProject },
  ].filter((action) => action.label.toLowerCase().includes(needle));

  return (
    <div className="palette-scrim" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label={t("searchChats")} onMouseDown={(event) => event.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder={t("searchChats")}
          aria-label={t("searchChats")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key !== "Enter") return;
            const action = actions[0];
            if (action !== undefined) return action.run();
            const session = hits[0];
            if (session !== undefined) onPick(session);
          }}
        />
        <div className="palette-list">
          {actions.length === 0 ? null : (
            <>
              <div className="palette-group">{t("quick")}</div>
              {actions.map((action) => (
                <button key={action.key} type="button" className="palette-item" onClick={action.run}>
                  <Icon d={action.icon} className="icon icon-sm" />
                  <span className="palette-name">{action.label}</span>
                </button>
              ))}
            </>
          )}
          {hits.length === 0 ? <div className="palette-empty">{t("noChats")}</div> : <div className="palette-group">{t("chats")}</div>}
          {hits.map((session) => (
            <button key={session.id} type="button" className="palette-item is-result" onClick={() => onPick(session)}>
              <span className="palette-name">{session.title === "" ? t("newChat") : session.title}</span>
              <span className="palette-where">
                {projectLabel(session.cwd, t("defaultProject"), names[session.cwd] ?? "")}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
