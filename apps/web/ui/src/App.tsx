import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatView } from "./components/ChatView.tsx";
import { applyEvent, type LiveTurn } from "./components/MessageList.tsx";
import { PluginsView } from "./components/PluginsView.tsx";
import { SearchPalette } from "./components/SearchPalette.tsx";
import { SettingsView } from "./components/SettingsView.tsx";
import { DEFAULT_PROJECT, projectLabel, Sidebar } from "./components/Sidebar.tsx";
import { describe, errorText } from "./lib/errors.ts";
import { useT } from "./lib/i18n.ts";
import {
  call,
  subscribe,
  type AppInfo,
  type Approval,
  type HostEvent,
  type SessionFile,
  type SessionMessage,
  type SessionSummary,
} from "./lib/rpc.ts";

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [kernelError, setKernelError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [projects, setProjects] = useState<string[]>(() => load<string[]>("maota.projects", []));
  const [names, setNames] = useState<Record<string, string>>(() => load<Record<string, string>>("maota.names", {}));
  const [removed, setRemoved] = useState<string[]>(() => load<string[]>("maota.removed", []));
  const [pinned, setPinned] = useState<string[]>(() => load<string[]>("maota.pinned", []));
  const [archived, setArchived] = useState<string[]>(() => load<string[]>("maota.archived", []));
  const [project, setProject] = useState<string>(() => load<string>("maota.project", DEFAULT_PROJECT));
  const [active, setActive] = useState<{ id: string; cwd: string } | null>(() =>
    load<{ id: string; cwd: string } | null>("maota.active", null),
  );
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ session: string; text: string } | null>(null);
  const [page, setPage] = useState<"chat" | "settings" | "plugins">("chat");
  const [palette, setPalette] = useState(false);
  const [picking, setPicking] = useState(false);
  const [manualPath, setManualPath] = useState(false);
  const [thinking, setThinking] = useState<string>(() => load<string>("maota.thinking", "off"));
  const [permission, setPermission] = useState<string>("ask");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [theme, setTheme] = useState<string>(() => load<string>("maota.theme", "system"));
  const [lives, setLives] = useState<Record<string, LiveTurn>>({});
  const [spawned, setSpawned] = useState<Record<string, SessionSummary[]>>({});

  const t = useT();
  const activeRef = useRef(active);
  const turns = useRef(new Map<string, string>());
  const loadSeq = useRef(0);

  useEffect(() => {
    activeRef.current = active;
    remember("maota.active", active);
  }, [active]);
  useEffect(() => remember("maota.projects", projects), [projects]);
  useEffect(() => remember("maota.names", names), [names]);
  useEffect(() => remember("maota.removed", removed), [removed]);
  useEffect(() => remember("maota.pinned", pinned), [pinned]);
  useEffect(() => remember("maota.archived", archived), [archived]);
  useEffect(() => remember("maota.project", project), [project]);
  useEffect(() => remember("maota.thinking", thinking), [thinking]);
  useEffect(() => remember("maota.theme", theme), [theme]);
  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: light)");
    const paint = (): void => {
      document.documentElement.dataset.theme =
        theme === "light" || (theme === "system" && system.matches) ? "light" : "dark";
    };
    paint();
    system.addEventListener("change", paint);
    return () => system.removeEventListener("change", paint);
  }, [theme]);

  const openSession = useCallback(async (id: string, cwd: string): Promise<void> => {
    const seq = ++loadSeq.current;
    try {
      const file = await call<SessionFile>("sessions.load", { id, cwd });
      if (seq !== loadSeq.current) return;
      setMessages(file.messages ?? []);
    } catch (error) {
      if (seq !== loadSeq.current) return;
      setMessages([]);
      setFailure({ session: id, text: describe(error) });
    }
  }, []);

  const refreshSessions = useCallback(async (): Promise<void> => {
    try {
      const reply = await call<{ sessions?: SessionSummary[] }>("sessions.list");
      setSessions(reply.sessions ?? []);
    } catch (error) {
      setKernelError(describe(error));
    }
  }, []);

  /// The sub-sessions a session spawned, keyed by the call each one came from.
  /// They are fetched rather than listed because a subagent's work is opened on
  /// demand: the sidebar and the search never see them.
  const loadSpawned = useCallback(async (sessionId: string, cwd: string): Promise<void> => {
    try {
      const reply = await call<{ children?: SessionSummary[] }>("sessions.children", { id: sessionId, cwd });
      const keyed: Record<string, SessionSummary[]> = {};
      for (const child of reply.children ?? []) {
        const callId = child.parent?.call_id ?? "";
        if (callId === "") continue;
        keyed[callId] = [...(keyed[callId] ?? []), child];
      }
      setSpawned(keyed);
    } catch {
      setSpawned({});
    }
  }, []);

  const loadInfo = useCallback(async (): Promise<void> => {
    try {
      const next = await call<AppInfo>("app.info");
      setInfo(next);
      setKernelError(null);
    } catch (error) {
      setKernelError(describe(error));
    }
  }, []);

  /// The approval mode lives with the session in the permission plugin, so the
  /// page asks for it instead of keeping a copy of its own.
  const loadPermission = useCallback(async (sessionId: string, cwd: string): Promise<void> => {
    try {
      const reply = await call<{ mode?: string }>("permission.get", { session_id: sessionId, cwd });
      if (typeof reply.mode === "string") setPermission(reply.mode);
    } catch {
    }
  }, []);

  const rebuildApprovals = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const reply = await call<{ requests?: Approval[] }>("permission.pending", { session_id: sessionId });
      setApprovals(reply.requests ?? []);
    } catch {
      setApprovals([]);
    }
  }, []);

  const handleEvent = useCallback(
    (event: HostEvent) => {
      if (event.event === "permission.request") {
        const id = event.request_id ?? "";
        if (id === "") return;
        const asked: Approval = {
          id,
          session_id: event.session_id ?? "",
          tool: event.tool ?? "",
          ...(event.call_id === undefined ? {} : { call_id: event.call_id }),
          ...(event.reason === undefined ? {} : { reason: event.reason }),
          ...(event.subagent === undefined ? {} : { subagent: event.subagent }),
        };
        setApprovals((prev) => (prev.some((item) => item.id === id) ? prev : [...prev, asked]));
        return;
      }
      if (event.event === "permission.settled") {
        const id = event.request_id ?? "";
        setApprovals((prev) => prev.filter((item) => item.id !== id));
        return;
      }

      const turnId = event.turn_id ?? "";
      if (turnId === "") return;

      if (event.event === "turn.start") {
        const sessionId = event.session_id ?? "";
        if (sessionId === "") return;
        turns.current.set(turnId, sessionId);
        setLives((prev) => ({
          ...prev,
          [sessionId]: {
            turn_id: turnId,
            text: "",
            reasoning: "",
            step: 0,
            tools: [],
            subagents: [],
            running: true,
          },
        }));
        return;
      }

      const sessionId = turns.current.get(turnId);
      if (sessionId === undefined) return;

      if (event.event === "turn.done" || event.event === "turn.cancelled" || event.event === "turn.error") {
        turns.current.delete(turnId);
        setLives((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        setPending(null);
        if (event.event === "turn.error") {
          setFailure({ session: sessionId, text: errorText(event.code ?? -32603, event.message ?? "") });
        }
        void refreshSessions();
        const current = activeRef.current;
        if (current !== null && current.id === sessionId) {
          void openSession(sessionId, current.cwd);
          void loadSpawned(sessionId, current.cwd);
        }
        return;
      }

      setLives((prev) => {
        const turn = prev[sessionId];
        return turn === undefined ? prev : { ...prev, [sessionId]: applyEvent(turn, event) };
      });
    },
    [loadSpawned, openSession, refreshSessions],
  );

  useEffect(() => {
    void loadInfo();
    void refreshSessions();
  }, [loadInfo, refreshSessions]);

  useEffect(
    () =>
      subscribe(handleEvent, () => {
        const current = activeRef.current;
        if (current !== null) {
          void openSession(current.id, current.cwd);
          void loadSpawned(current.id, current.cwd);
          void rebuildApprovals(current.id);
        }
        void refreshSessions();
      }),
    [handleEvent, loadSpawned, openSession, rebuildApprovals, refreshSessions],
  );

  useEffect(() => {
    if (active === null) {
      setMessages([]);
      setApprovals([]);
      setSpawned({});
      return;
    }
    void openSession(active.id, active.cwd);
    void loadSpawned(active.id, active.cwd);
    void loadPermission(active.id, active.cwd);
    void rebuildApprovals(active.id);
  }, [active, loadPermission, loadSpawned, openSession, rebuildApprovals]);

  const send = useCallback(
    async (text: string, at: { id: string; cwd: string }): Promise<void> => {
      if (text.trim() === "") return;
      setFailure(null);
      setPending(text);
      try {
        await call<{ turn_id: string }>("chat.send", {
          session_id: at.id,
          cwd: at.cwd,
          input: text,
          thinking,
        });
      } catch (error) {
        setPending(null);
        setFailure({ session: at.id, text: describe(error) });
      }
    },
    [thinking],
  );

  const submit = useCallback(
    (text: string): void => {
      const current = activeRef.current;
      if (current !== null) {
        void send(text, current);
        return;
      }
      const fresh = { id: crypto.randomUUID(), cwd: project };
      activeRef.current = fresh;
      setFailure(null);
      setActive(fresh);
      void send(text, fresh);
    },
    [project, send],
  );

  const cancel = async (): Promise<void> => {
    const current = activeRef.current;
    const turn = current === null ? undefined : lives[current.id];
    if (current === null || turn === undefined) return;
    try {
      await call("chat.cancel", { turn_id: turn.turn_id });
    } catch (error) {
      setFailure({ session: current.id, text: describe(error) });
    }
  };

  const answer = useCallback(
    async (id: string, decision: "allow" | "deny"): Promise<void> => {
      const current = activeRef.current;
      try {
        await call("permission.answer", { id, decision });
        setApprovals((prev) => prev.filter((item) => item.id !== id));
      } catch (error) {
        setFailure({ session: current?.id ?? "", text: describe(error) });
        if (current !== null) void rebuildApprovals(current.id);
      }
    },
    [rebuildApprovals],
  );

  const changePermission = useCallback(
    async (mode: string): Promise<void> => {
      const current = activeRef.current;
      if (current === null) return;
      try {
        const reply = await call<{ mode?: string }>("permission.set", {
          session_id: current.id,
          cwd: current.cwd,
          mode,
        });
        if (typeof reply.mode === "string") setPermission(reply.mode);
        return;
      } catch (error) {
        setFailure({ session: current.id, text: describe(error) });
      }
      void loadPermission(current.id, current.cwd);
    },
    [loadPermission],
  );

  const newChat = (cwd: string): void => {
    setFailure(null);
    setPending(null);
    setPage("chat");
    setRemoved((prev) => prev.filter((item) => item !== cwd));
    const fresh = { id: crypto.randomUUID(), cwd };
    activeRef.current = fresh;
    setActive(fresh);
  };

  const open = (session: SessionSummary): void => {
    setFailure(null);
    setPending(null);
    setPage("chat");
    setActive({ id: session.id, cwd: session.cwd === "" ? DEFAULT_PROJECT : session.cwd });
  };

  const addProject = (cwd: string): void => {
    setProjects((prev) => (prev.includes(cwd) ? prev : [...prev, cwd]));
    setRemoved((prev) => prev.filter((item) => item !== cwd));
    setProject(cwd);
  };

  const pickProject = async (): Promise<void> => {
    if (picking) return;
    setPicking(true);
    try {
      const reply = await call<{ path: string | null }>("workspace.pick");
      if (reply.path !== null) addProject(reply.path);
    } catch {
      setManualPath(true);
    } finally {
      setPicking(false);
    }
  };

  const allSessions = useMemo(() => {
    if (active === null || sessions.some((session) => session.id === active.id)) return sessions;
    return [{ id: active.id, cwd: active.cwd, title: "", updated_at: new Date().toISOString() }, ...sessions];
  }, [active, sessions]);

  const groups = useMemo(() => {
    const cwds = new Set<string>([DEFAULT_PROJECT, project, ...projects]);
    for (const session of allSessions) cwds.add(session.cwd === "" ? DEFAULT_PROJECT : session.cwd);
    return [...cwds]
      .filter((cwd) => !removed.includes(cwd))
      .map((cwd) => ({
        cwd,
        sessions: allSessions
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
  }, [allSessions, archived, names, pinned, project, projects, removed]);

  const pinnedRows = useMemo(
    () => allSessions.filter((session) => pinned.includes(session.id) && !archived.includes(session.id)),
    [allSessions, archived, pinned],
  );

  const archivedRows = useMemo(
    () => allSessions.filter((session) => archived.includes(session.id)),
    [allSessions, archived],
  );

  const searchable = useMemo(
    () => allSessions.filter((session) => !archived.includes(session.id)),
    [allSessions, archived],
  );

  const renameProject = (cwd: string, name: string): void => {
    setNames((prev) => {
      const next = { ...prev };
      if (name === "") delete next[cwd];
      else next[cwd] = name;
      return next;
    });
  };

  const removeProject = (cwd: string): void => {
    setProjects((prev) => prev.filter((item) => item !== cwd));
    setRemoved((prev) => (prev.includes(cwd) ? prev : [...prev, cwd]));
    if (project === cwd) setProject(DEFAULT_PROJECT);
  };

  const flip = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  const flipPin = (id: string): void => setPinned((prev) => flip(prev, id));
  const flipArchive = (id: string): void => setArchived((prev) => flip(prev, id));

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((was) => !was);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (page === "settings") {
    return (
      <SettingsView info={info} theme={theme} onTheme={setTheme} onBack={() => setPage("chat")} />
    );
  }

  const title = allSessions.find((item) => item.id === active?.id)?.title || t("newChat");

  return (
    <div className="app">
      <Sidebar
        groups={groups}
        pinned={pinnedRows}
        archived={archivedRows}
        names={names}
        project={project}
        activeId={active?.id ?? null}
        running={Object.keys(lives)}
        onNew={newChat}
        onProject={setProject}
        onAddProject={addProject}
        onPickProject={() => void pickProject()}
        picking={picking}
        manual={manualPath}
        onManual={setManualPath}
        onOpen={open}
        onRename={renameProject}
        onRemoveProject={removeProject}
        onPin={flipPin}
        onArchive={flipArchive}
        onSettings={() => setPage("settings")}
        onPlugins={() => setPage("plugins")}
        onSearch={() => setPalette(true)}
      />
      {page === "plugins" ? (
        <PluginsView info={info} />
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
          onRetry={() => void loadInfo()}
          onKeySaved={() => void loadInfo()}
          onThinking={setThinking}
          onPermission={(mode) => void changePermission(mode)}
          onAnswer={(id, decision) => void answer(id, decision)}
          onSend={submit}
          onCancel={() => void cancel()}
        />
      )}
      {palette ? (
        <SearchPalette
          sessions={searchable}
          names={names}
          onNew={() => {
            setPalette(false);
            newChat(project);
          }}
          onAddProject={() => {
            setPalette(false);
            void pickProject();
          }}
          onPick={(session) => {
            setPalette(false);
            open(session);
          }}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </div>
  );
}
