import { useCallback, useState, type MutableRefObject } from "react";

import { call, type AppInfo, type ContextView, type HostEvent, type ModelRoute, type SessionFile, type SessionMessage } from "./lib/rpc.ts";

export function useContextCompact({
  activeRef,
  info,
  thinking,
  modelRoute,
  onMessages,
  onFailure,
}: {
  activeRef: MutableRefObject<{ id: string; cwd: string } | null>;
  info: AppInfo | null;
  thinking: string;
  modelRoute: ModelRoute | null;
  onMessages: (messages: SessionMessage[]) => void;
  onFailure: (session: string, message: string) => void;
}) {
  const [context, setContext] = useState<ContextView | null>(null);
  const clearContext = useCallback((): void => setContext(null), []);

  const model = useCallback((): string | undefined => {
    if (modelRoute !== null) return modelRoute.model;
    const value = info?.thinking?.[thinking]?.model;
    return typeof value === "string" && value !== "" ? value : undefined;
  }, [info, modelRoute, thinking]);

  const loadContext = useCallback(async (id: string, cwd: string): Promise<void> => {
    try {
      setContext(await call<ContextView>("chat.context", {
        session_id: id,
        cwd,
        ...(model() === undefined ? {} : { model: model() }),
      }));
    } catch {
      setContext(null);
    }
  }, [model]);

  const reload = useCallback(async (id: string, cwd: string): Promise<void> => {
    const file = await call<SessionFile>("sessions.load", { id, cwd });
    onMessages(file.messages ?? []);
    await loadContext(id, cwd);
  }, [loadContext, onMessages]);

  const compactNow = useCallback(async (): Promise<void> => {
    const current = activeRef.current;
    if (current === null) return;
    try {
      await call("chat.compact", {
        session_id: current.id,
        cwd: current.cwd,
        ...(model() === undefined ? {} : { model: model() }),
      });
      await reload(current.id, current.cwd);
    } catch (error) {
      onFailure(current.id, error instanceof Error ? error.message : String(error));
    }
  }, [activeRef, model, onFailure, reload]);

  const onCompactEvent = useCallback((event: HostEvent): boolean => {
    if (!event.event.startsWith("compact.")) return false;
    const sessionId = event.session_id ?? "";
    if (sessionId === "") return true;
    const current = activeRef.current;
    const cwd = current?.id === sessionId ? current.cwd : "";
    if (event.event === "compact.failed") {
      onFailure(sessionId, event.error ?? "compaction failed");
      void loadContext(sessionId, cwd);
    } else if (event.event === "compact.committed" && current !== null && current.id === sessionId) {
      void reload(sessionId, cwd);
    } else {
      void loadContext(sessionId, cwd);
    }
    return true;
  }, [activeRef, loadContext, onFailure, reload]);

  return { context, clearContext, compactNow, loadContext, onCompactEvent };
}

