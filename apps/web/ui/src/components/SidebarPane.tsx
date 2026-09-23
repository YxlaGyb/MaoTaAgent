/// The sidebar pane: the project and session tree beside the chat. It folds
/// the session list into project groups, keeps pinned and archived rows apart,
/// and hands the sorted result to Sidebar.

import { useMemo } from "react";

import type { SessionSummary } from "../lib/rpc.ts";
import { DEFAULT_PROJECT, projectLabel, Sidebar } from "./Sidebar.tsx";

export function SidebarPane({
  sessions,
  activeId,
  projects,
  names,
  pinned,
  archived,
  removed,
  project,
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
  sessions: SessionSummary[];
  activeId: string | null;
  projects: string[];
  names: Record<string, string>;
  pinned: string[];
  archived: string[];
  removed: string[];
  project: string;
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
  const groups = useMemo(() => {
    const cwds = new Set<string>([DEFAULT_PROJECT, project, ...projects]);
    for (const session of sessions) cwds.add(session.cwd === "" ? DEFAULT_PROJECT : session.cwd);
    return [...cwds]
      .filter((cwd) => !removed.includes(cwd))
      .map((cwd) => ({
        cwd,
        sessions: sessions
          .filter((session) => (session.cwd === "" ? DEFAULT_PROJECT : session.cwd) === cwd)
          .filter((session) => !archived.includes(session.id))
          .sort(
            (left, right) =>
              Number(pinned.includes(right.id)) - Number(pinned.includes(left.id)) ||
              right.updated_at.localeCompare(left.updated_at),
          ),
      }))
      .sort((left, right) => {
        if (left.cwd === DEFAULT_PROJECT) return -1;
        if (right.cwd === DEFAULT_PROJECT) return 1;
        const leftName = projectLabel(left.cwd, "", names[left.cwd] ?? "");
        const rightName = projectLabel(right.cwd, "", names[right.cwd] ?? "");
        return leftName.localeCompare(rightName);
      });
  }, [archived, names, pinned, project, projects, removed, sessions]);

  const pinnedRows = useMemo(
    () => sessions.filter((session) => pinned.includes(session.id) && !archived.includes(session.id)),
    [archived, pinned, sessions],
  );

  const archivedRows = useMemo(
    () => sessions.filter((session) => archived.includes(session.id)),
    [archived, sessions],
  );

  return (
    <Sidebar
      groups={groups}
      pinned={pinnedRows}
      archived={archivedRows}
      names={names}
      project={project}
      activeId={activeId}
      running={running}
      onNew={onNew}
      onProject={onProject}
      onAddProject={onAddProject}
      onPickProject={onPickProject}
      picking={picking}
      manual={manual}
      onManual={onManual}
      onOpen={onOpen}
      onRename={onRename}
      onRemoveProject={onRemoveProject}
      onPin={onPin}
      onArchive={onArchive}
      onSettings={onSettings}
      onPlugins={onPlugins}
      onSkills={onSkills}
      onSearch={onSearch}
    />
  );
}
