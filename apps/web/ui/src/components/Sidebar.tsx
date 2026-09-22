import { useState } from "react";
import { MaoBadge, MaoTextField } from "maotaui";

import { useT } from "../lib/i18n.ts";
import type { SessionSummary } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { Popover } from "./Popover.tsx";

export const DEFAULT_PROJECT = "";

export function projectLabel(cwd: string, fallback = "", name = ""): string {
  if (name !== "") return name;
  if (cwd === DEFAULT_PROJECT) return fallback;
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== "");
  return parts.at(-1) ?? cwd;
}

export interface ProjectGroup {
  cwd: string;
  sessions: SessionSummary[];
}

function SessionRow({
  session,
  active,
  running,
  pinned,
  archived,
  onOpen,
  onPin,
  onArchive,
}: {
  session: SessionSummary;
  active: boolean;
  running: boolean;
  pinned: boolean;
  archived: boolean;
  onOpen: () => void;
  onPin: () => void;
  onArchive: () => void;
}) {
  const t = useT();
  const pinLabel = pinned ? t("unpin") : t("pin");
  const archiveLabel = archived ? t("restore") : t("archive");

  return (
    <div className={`side-item side-sub${active ? " is-on" : ""}`}>
      <button type="button" className="side-open" onClick={onOpen}>
        <span className="side-name">{session.title === "" ? t("newChat") : session.title}</span>
      </button>
      {running ? <MaoBadge tone="accent">{t("running")}</MaoBadge> : null}
      <span className="side-acts">
        <button
          type="button"
          className={`side-icon${pinned ? " is-on" : ""}`}
          title={pinLabel}
          aria-label={pinLabel}
          aria-pressed={pinned}
          onClick={onPin}
        >
          <Icon d={ICON.pin} />
        </button>
        <button type="button" className="side-icon" title={archiveLabel} aria-label={archiveLabel} onClick={onArchive}>
          <Icon d={archived ? ICON.restore : ICON.archive} />
        </button>
      </span>
    </div>
  );
}

export function Sidebar({
  groups,
  pinned,
  archived,
  names,
  project,
  activeId,
  running,
  onNew,
  onProject,
  onAddProject,
  onPickProject,
  picking,
  manual,
  onManual,
  onOpen,
  onRename,
  onRemoveProject,
  onPin,
  onArchive,
  onSettings,
  onPlugins,
  onSkills,
  onSearch,
}: {
  groups: ProjectGroup[];
  pinned: SessionSummary[];
  archived: SessionSummary[];
  names: Record<string, string>;
  project: string;
  activeId: string | null;
  running: string[];
  onNew: (cwd: string) => void;
  onProject: (cwd: string) => void;
  onAddProject: (cwd: string) => void;
  onPickProject: () => void;
  picking: boolean;
  manual: boolean;
  onManual: (open: boolean) => void;
  onOpen: (session: SessionSummary) => void;
  onRename: (cwd: string, name: string) => void;
  onRemoveProject: (cwd: string) => void;
  onPin: (id: string) => void;
  onArchive: (id: string) => void;
  onSettings: () => void;
  onPlugins: () => void;
  onSkills: () => void;
  onSearch: () => void;
}) {
  const t = useT();
  const [path, setPath] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const pinnedIds = new Set(pinned.map((session) => session.id));

  const commit = (cwd: string): void => {
    onRename(cwd, draft.trim());
    setRenaming(null);
    setDraft("");
  };

  const row = (session: SessionSummary, isPinned: boolean, isArchived: boolean) => (
    <SessionRow
      key={session.id}
      session={session}
      active={session.id === activeId}
      running={running.includes(session.id)}
      pinned={isPinned}
      archived={isArchived}
      onOpen={() => onOpen(session)}
      onPin={() => onPin(session.id)}
      onArchive={() => onArchive(session.id)}
    />
  );

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <span>MaoTa</span>
        <button type="button" className="side-icon" title={t("searchChats")} aria-label={t("searchChats")} onClick={onSearch}>
          <Icon d={ICON.search} />
        </button>
      </div>

      <nav className="side-nav">
        <button type="button" className="side-row" onClick={() => onNew(project)}>
          <Icon d={ICON.chat} />
          {t("newChat")}
        </button>
        <button type="button" className="side-row">
          <Icon d={ICON.clock} />
          {t("tasks")}
        </button>
        <button type="button" className="side-row" onClick={onPlugins}>
          <Icon d={ICON.plug} />
          {t("plugins")}
        </button>
        <button type="button" className="side-row" onClick={onSkills}>
          <Icon d={ICON.bulb} />
          {t("skills")}
        </button>
      </nav>

      <div className="side-body">
        {pinned.length === 0 ? null : (
          <div className="side-block">
            <div className="side-head">{t("pinned")}</div>
            {pinned.map((session) => row(session, true, false))}
          </div>
        )}

        <div className="side-block">
          <div className="side-head">
            <span>{t("workspaces")}</span>
            <button
              type="button"
              className="side-icon"
              title={t("addProject")}
              aria-label={t("addProject")}
              disabled={picking}
              aria-busy={picking || undefined}
              onClick={onPickProject}
            >
              {picking ? <span className="mt-btn-spinner" /> : <Icon d={ICON.plus} />}
            </button>
          </div>
          {groups.map((group) => (
            <div key={group.cwd}>
              <div className={`side-item side-project${group.cwd === project ? " is-on" : ""}`}>
                {renaming === group.cwd ? (
                  <MaoTextField
                    autoFocus
                    className="side-path"
                    placeholder={projectLabel(group.cwd, t("defaultProject"))}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(group.cwd)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commit(group.cwd);
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="side-open"
                    title={group.cwd === DEFAULT_PROJECT ? t("noWorkdir") : group.cwd}
                    onClick={() => onProject(group.cwd)}
                  >
                    <Icon d={ICON.folder} />
                    <span className="side-name">{projectLabel(group.cwd, t("defaultProject"), names[group.cwd] ?? "")}</span>
                  </button>
                )}
                <span className="side-acts">
                  <button
                    type="button"
                    className="side-icon"
                    title={t("newSession")}
                    aria-label={t("newSession")}
                    onClick={() => onNew(group.cwd)}
                  >
                    <Icon d={ICON.plus} />
                  </button>
                  <Popover
                    className="side-more"
                    title={t("more")}
                    align="end"
                    open={menu === group.cwd}
                    onToggle={() => setMenu(menu === group.cwd ? null : group.cwd)}
                    onClose={() => setMenu(null)}
                    label={<Icon d={ICON.more} />}
                  >
                    <button
                      type="button"
                      className="option"
                      onClick={() => {
                        setMenu(null);
                        setRenaming(group.cwd);
                        setDraft(names[group.cwd] ?? "");
                      }}
                    >
                      <span className="option-text">
                        <span className="option-name">{t("rename")}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="option is-danger"
                      onClick={() => {
                        setMenu(null);
                        onRemoveProject(group.cwd);
                      }}
                    >
                      <span className="option-text">
                        <span className="option-name">{t("removeProject")}</span>
                      </span>
                    </button>
                  </Popover>
                </span>
              </div>
              {group.sessions.map((session) => row(session, pinnedIds.has(session.id), false))}
              {group.sessions.length === 0 && group.cwd === project ? (
                <div className="side-empty">{t("noSessions")}</div>
              ) : null}
            </div>
          ))}

          {manual ? (
            <MaoTextField
              autoFocus
              className="side-path"
              placeholder={t("pathPlaceholder")}
              value={path}
              onChange={(event) => setPath(event.target.value)}
              onBlur={() => {
                setPath("");
                onManual(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const value = path.trim();
                  if (value !== "") onAddProject(value);
                  setPath("");
                  onManual(false);
                }
                if (event.key === "Escape") {
                  setPath("");
                  onManual(false);
                }
              }}
            />
          ) : null}
        </div>

        {archived.length === 0 ? null : (
          <div className="side-block">
            <div className="side-head">{t("archived")}</div>
            {archived.map((session) => row(session, pinnedIds.has(session.id), true))}
          </div>
        )}
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
