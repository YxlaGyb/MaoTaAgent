import { useState } from "react";
import { Badge, TextField } from "maotaui";

import { useT } from "../lib/i18n.ts";
import { call, type SessionSummary } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";

export const DEFAULT_PROJECT = "";

export function projectLabel(cwd: string, fallback = ""): string {
  if (cwd === DEFAULT_PROJECT) return fallback;
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== "");
  return parts.at(-1) ?? cwd;
}

function timeLabel(stamp: string): string {
  const date = new Date(stamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === new Date().toDateString() ? clock : `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function Sidebar({
  projects,
  project,
  sessions,
  activeId,
  running,
  onNew,
  onProject,
  onAddProject,
  onOpen,
  onSettings,
}: {
  projects: string[];
  project: string;
  sessions: SessionSummary[];
  activeId: string | null;
  running: string[];
  onNew: () => void;
  onProject: (cwd: string) => void;
  onAddProject: (cwd: string) => void;
  onOpen: (session: SessionSummary) => void;
  onSettings: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
  const t = useT();

  const close = (): void => {
    setPath("");
    setAdding(false);
  };

  const pick = async (): Promise<void> => {
    try {
      const reply = await call<{ path: string | null }>("workspace.pick");
      if (reply.path !== null) onAddProject(reply.path);
    } catch (error) {
      setAdding(true);
    }
  };

  return (
    <aside className="sidebar">
      <div className="side-brand">MaoTa</div>

      <nav className="side-nav">
        <button type="button" className="side-row" onClick={onNew}>
          <Icon d={ICON.chat} />
          {t("newChat")}
        </button>
        <button type="button" className="side-row">
          <Icon d={ICON.clock} />
          {t("tasks")}
        </button>
        <button type="button" className="side-row">
          <Icon d={ICON.plug} />
          {t("plugins")}
        </button>
      </nav>

      <div className="side-body">
        <div className="side-block">
          <div className="side-head">
            <span>{t("workspaces")}</span>
            <button
              type="button"
              className="side-add"
              title={t("addWorkspace")}
              onClick={() => void pick()}
            >
              <Icon d={ICON.plus} />
            </button>
          </div>
          {projects.map((cwd) => (
            <button
              key={cwd}
              type="button"
              title={cwd === DEFAULT_PROJECT ? t("noWorkdir") : cwd}
              className={`side-item${cwd === project ? " is-on" : ""}`}
              onClick={() => onProject(cwd)}
            >
              <Icon d={ICON.folder} />
              <span className="side-name">{projectLabel(cwd, t("defaultProject"))}</span>
            </button>
          ))}
          {adding ? (
            <TextField
              autoFocus
              className="side-path"
              placeholder={t("pathPlaceholder")}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onBlur={close}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const value = path.trim();
                  if (value !== "") onAddProject(value);
                  close();
                }
                if (event.key === "Escape") close();
              }}
            />
          ) : null}
        </div>

        <div className="side-block">
          <div className="side-head">
            <span>{t("sessions")}</span>
          </div>
          {sessions.length === 0 ? <div className="side-empty">{t("noSessions")}</div> : null}
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`side-item side-sub${session.id === activeId ? " is-on" : ""}`}
              onClick={() => onOpen(session)}
            >
              <span className="side-name">{session.title === "" ? t("newChat") : session.title}</span>
              {running.includes(session.id) ? (
                <Badge tone="accent">{t("running")}</Badge>
              ) : (
                <span className="side-time">{timeLabel(session.updated_at)}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="side-foot">
        <button type="button" className="side-row" onClick={onSettings}>
          <Icon d={ICON.sliders} />
          {t("settings")}
        </button>
      </div>
    </aside>
  );
}
