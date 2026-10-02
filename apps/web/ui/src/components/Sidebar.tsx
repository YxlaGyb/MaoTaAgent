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
          <Icon name={ICON.pin} />
        </button>
        <button type="button" className="side-icon" title={archiveLabel} aria-label={archiveLabel} onClick={onArchive}>
          <Icon name={archived ? ICON.restore : ICON.archive} />
        </button>
      </span>
    </div>
  );
}

export function Sidebar({
  groups,
  ungrouped,
  recent,
  pinned,
  archived,
  names,
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
  onTasks,
  onSearch,
}: {
  groups: ProjectGroup[];
  ungrouped: SessionSummary[];
  recent: SessionSummary[];
  pinned: SessionSummary[];
  archived: SessionSummary[];
  names: Record<string, string>;
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
  onTasks: () => void;
  onSearch: () => void;
}) {
  const t = useT();
  const [path, setPath] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const pinnedIds = new Set(pinned.map((session) => session.id));

  const commit = (cwd: string): void => {
    onRename(cwd, draft.trim());
    setRenaming(null);
    setDraft("");
  };

  const toggleProject = (cwd: string): void => {
    onProject(cwd);
    setCollapsed((was) => (was.includes(cwd) ? was.filter((item) => item !== cwd) : [...was, cwd]));
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
          <Icon name={ICON.search} />
        </button>
      </div>

      <nav className="side-nav">
        <button type="button" className="side-row" onClick={() => onNew(DEFAULT_PROJECT)}>
          <Icon name={ICON.chat} />
          {t("newChat")}
        </button>
        <button type="button" className="side-row" onClick={onTasks}>
          <Icon name={ICON.clock} />
          {t("tasks")}
        </button>
        <button type="button" className="side-row" onClick={onPlugins}>
          <Icon name={ICON.plug} />
          {t("plugins")}
        </button>
      </nav>

      <div className="side-body">
        {pinned.length === 0 ? null : (
          <div className="side-block">
            <div className="side-head">{t("pinned")}</div>
            {pinned.map((session) => row(session, true, false))}
          </div>
        )}

        {ungrouped.length === 0 ? null : (
          <div className="side-block">
            <div className="side-head">{t("ungrouped")}</div>
            {ungrouped.map((session) => row(session, pinnedIds.has(session.id), false))}
          </div>
        )}

        <div className="side-block">
          <div className="side-head">
            <span className="side-head-title">{t("workspaces")}</span>
            <span className="side-head-actions">
              <button
                type="button"
                className="side-icon"
                title={projectsOpen ? t("collapse") : t("expand")}
                aria-label={projectsOpen ? t("collapse") : t("expand")}
                aria-expanded={projectsOpen}
                onClick={() => setProjectsOpen((was) => !was)}
              >
                <Icon name={projectsOpen ? ICON.chevronDown : ICON.chevronRight} />
              </button>
              <button
                type="button"
                className="side-icon"
                title={t("addProject")}
                aria-label={t("addProject")}
                disabled={picking}
                aria-busy={picking || undefined}
                onClick={onPickProject}
              >
                {picking ? <span className="mt-btn-spinner" /> : <Icon name={ICON.plus} />}
              </button>
            </span>
          </div>
          {projectsOpen ? (
            <>
              {groups.map((group) => {
                const open = !collapsed.includes(group.cwd);
                return (
                  <div key={group.cwd} className="side-project-group">
                    <div className="side-item side-project">
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
                          title={group.cwd}
                          aria-expanded={open}
                          onClick={() => toggleProject(group.cwd)}
                        >
                          <Icon name={open ? ICON.folderOpen : ICON.folder} className="icon side-project-folder" />
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
                          <Icon name={ICON.plus} />
                        </button>
                        <Popover
                          className="side-more"
                          title={t("more")}
                          align="end"
                          open={menu === group.cwd}
                          onToggle={() => setMenu(menu === group.cwd ? null : group.cwd)}
                          onClose={() => setMenu(null)}
                          label={<Icon name={ICON.more} />}
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
                    {open ? (
                      <div className="side-children">
                        {group.sessions.map((session) => row(session, pinnedIds.has(session.id), false))}
                        {group.sessions.length === 0 ? (
                          <button type="button" className="side-item side-sub side-new" onClick={() => onNew(group.cwd)}>
                            <Icon name={ICON.plus} className="icon icon-sm" />
                            <span className="side-name">{t("newChat")}</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}

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
            </>
          ) : null}
        </div>

        <div className="side-block">
          <div className="side-head">
            <span className="side-head-title">{t("recent")}</span>
            <span className="side-head-actions">
              <button
                type="button"
                className="side-icon"
                title={recentOpen ? t("collapse") : t("expand")}
                aria-label={recentOpen ? t("collapse") : t("expand")}
                aria-expanded={recentOpen}
                onClick={() => setRecentOpen((was) => !was)}
              >
                <Icon name={recentOpen ? ICON.chevronDown : ICON.chevronRight} />
              </button>
              <button
                type="button"
                className="side-icon"
                title={t("newChat")}
                aria-label={t("newChat")}
                onClick={() => onNew(DEFAULT_PROJECT)}
              >
                <Icon name={ICON.plus} />
              </button>
            </span>
          </div>
          {recentOpen ? (
            recent.length === 0 ? (
              <div className="side-empty">{t("noRecent")}</div>
            ) : (
              recent.map((session) => row(session, pinnedIds.has(session.id), false))
            )
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
          <Icon name={ICON.sliders} />
          {t("settings")}
        </button>
      </div>
    </aside>
  );
}
