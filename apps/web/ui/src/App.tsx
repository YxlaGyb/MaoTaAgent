import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatView } from "./components/ChatView.tsx";
import { applyEvent, type LiveTurn } from "./components/MessageList.tsx";
import { SettingsView } from "./components/SettingsView.tsx";
import { DEFAULT_PROJECT, Sidebar } from "./components/Sidebar.tsx";
import { describe, errorText } from "./lib/errors.ts";
import {
  call,
  subscribe,
  type AppInfo,
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
  const [project, setProject] = useState<string>(() => load<string>("maota.project", DEFAULT_PROJECT));
  const [active, setActive] = useState<{ id: string; cwd: string } | null>(() =>
    load<{ id: string; cwd: string } | null>("maota.active", null),
  );
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ session: string; text: string } | null>(null);
  const [page, setPage] = useState<"chat" | "settings">("chat");
  const [thinking, setThinking] = useState<string>(() => load<string>("maota.thinking", "off"));
  const [permission, setPermission] = useState<string>(() => load<string>("maota.permission", "ask"));
  const [lives, setLives] = useState<Record<string, LiveTurn>>({});

  const activeRef = useRef(active);
  const turns = useRef(new Map<string, string>());
  const loadSeq = useRef(0);

  useEffect(() => {
    activeRef.current = active;
    remember("maota.active", active);
  }, [active]);
  useEffect(() => remember("maota.projects", projects), [projects]);
  useEffect(() => remember("maota.project", project), [project]);
  useEffect(() => remember("maota.thinking", thinking), [thinking]);
  useEffect(() => remember("maota.permission", permission), [permission]);

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

  const loadInfo = useCallback(async (): Promise<void> => {
    try {
      const next = await call<AppInfo>("app.info");
      setInfo(next);
      setKernelError(null);
    } catch (error) {
      setKernelError(describe(error));
    }
  }, []);

  const handleEvent = useCallback(
    (event: HostEvent) => {
      const turnId = event.turn_id ?? "";
      if (turnId === "") return;

      if (event.event === "turn.start") {
        const sessionId = event.session_id ?? "";
        if (sessionId === "") return;
        turns.current.set(turnId, sessionId);
        setLives((prev) => ({
          ...prev,
          [sessionId]: { turn_id: turnId, text: "", reasoning: "", step: 0, tools: [], running: true },
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
        if (current !== null && current.id === sessionId) void openSession(sessionId, current.cwd);
        return;
      }

      setLives((prev) => {
        const turn = prev[sessionId];
        return turn === undefined ? prev : { ...prev, [sessionId]: applyEvent(turn, event) };
      });
    },
    [openSession, refreshSessions],
  );

  useEffect(() => {
    void loadInfo();
    void refreshSessions();
  }, [loadInfo, refreshSessions]);

  useEffect(
    () =>
      subscribe(handleEvent, () => {
        const current = activeRef.current;
        if (current !== null) void openSession(current.id, current.cwd);
        void refreshSessions();
      }),
    [handleEvent, openSession, refreshSessions],
  );

  useEffect(() => {
    if (active === null) {
      setMessages([]);
      return;
    }
    void openSession(active.id, active.cwd);
  }, [active, openSession]);

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

  const newChat = (): void => {
    setFailure(null);
    setPending(null);
    const fresh = { id: crypto.randomUUID(), cwd: project };
    activeRef.current = fresh;
    setActive(fresh);
  };

  const open = (session: SessionSummary): void => {
    setFailure(null);
    setPending(null);
    setActive({ id: session.id, cwd: session.cwd === "" ? DEFAULT_PROJECT : session.cwd });
  };

  const addProject = (cwd: string): void => {
    setProjects((prev) => (prev.includes(cwd) ? prev : [...prev, cwd]));
    setProject(cwd);
  };

  const listed = useMemo(() => {
    const mine = sessions.filter((session) => (session.cwd === "" ? DEFAULT_PROJECT : session.cwd) === project);
    if (active !== null && active.cwd === project && !mine.some((session) => session.id === active.id)) {
      return [{ id: active.id, cwd: active.cwd, title: "", updated_at: new Date().toISOString() }, ...mine];
    }
    return mine;
  }, [active, project, sessions]);

  const allProjects = useMemo(() => {
    const seen = new Set<string>([DEFAULT_PROJECT, project, ...projects]);
    for (const session of sessions) seen.add(session.cwd === "" ? DEFAULT_PROJECT : session.cwd);
    return [...seen].sort((left, right) => {
      if (left === DEFAULT_PROJECT) return -1;
      if (right === DEFAULT_PROJECT) return 1;
      return left.localeCompare(right);
    });
  }, [project, projects, sessions]);

  if (page === "settings") {
    return (
      <SettingsView
        info={info}
        permission={permission}
        onPermission={setPermission}
        onKeySaved={() => void loadInfo()}
        onBack={() => setPage("chat")}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        projects={allProjects}
        project={project}
        sessions={listed}
        activeId={active?.id ?? null}
        running={Object.keys(lives)}
        onNew={newChat}
        onProject={setProject}
        onAddProject={addProject}
        onOpen={open}
        onSettings={() => setPage("settings")}
      />
      <ChatView
        info={info}
        kernelError={kernelError}
        session={active}
        messages={messages}
        pending={pending}
        live={active === null ? null : (lives[active.id] ?? null)}
        failure={failure !== null && active !== null && failure.session === active.id ? failure.text : null}
        hasKey={info?.has_key ?? null}
        thinking={thinking}
        permission={permission}
        onRetry={() => void loadInfo()}
        onKeySaved={() => void loadInfo()}
        onThinking={setThinking}
        onPermission={setPermission}
        onSend={submit}
        onCancel={() => void cancel()}
      />
    </div>
  );
}
