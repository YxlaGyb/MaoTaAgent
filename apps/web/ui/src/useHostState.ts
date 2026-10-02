import { useCallback, useState } from "react";

import { describe } from "./lib/errors.ts";
import { setLang } from "./lib/i18n.ts";
import { call, type SettingsView, type WorkspaceView } from "./lib/rpc.ts";

const EMPTY_SETTINGS: SettingsView = { revision: 0, locale: null, theme: null };
const EMPTY_WORKSPACE: WorkspaceView = { revision: 0, projects: [], pinned_sessions: [], archived_sessions: [] };

export function useHostState({
  localeFallback,
  onError,
}: {
  localeFallback: string | undefined;
  onError: (message: string) => void;
}) {
  const [settings, setSettings] = useState<SettingsView>(EMPTY_SETTINGS);
  const [workspace, setWorkspace] = useState<WorkspaceView>(EMPTY_WORKSPACE);

  const adoptSettings = useCallback((next: SettingsView): void => {
    setSettings((current) => next.revision >= current.revision ? next : current);
    setLang(next.locale ?? localeFallback ?? "system");
  }, [localeFallback]);

  const adoptWorkspace = useCallback((next: WorkspaceView): void => {
    setWorkspace((current) => next.revision >= current.revision ? next : current);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Pick<SettingsView, "locale" | "theme">>): Promise<void> => {
      const before = settings;
      setSettings({ ...settings, ...patch });
      if ("locale" in patch) setLang(patch.locale ?? localeFallback ?? "system");
      try {
        const saved = await call<SettingsView>("settings.update", {
          patch,
          expected_revision: settings.revision,
        });
        adoptSettings(saved);
      } catch (error) {
        setSettings(before);
        setLang(before.locale ?? localeFallback ?? "system");
        onError(describe(error));
      }
    },
    [adoptSettings, localeFallback, onError, settings],
  );

  const updateWorkspace = useCallback(
    async (method: string, params: Record<string, unknown>): Promise<WorkspaceView | undefined> => {
      try {
        const next = await call<WorkspaceView>(method, { ...params, expected_revision: workspace.revision });
        adoptWorkspace(next);
        return next;
      } catch (error) {
        onError(describe(error));
        return undefined;
      }
    },
    [adoptWorkspace, onError, workspace.revision],
  );

  return { settings, workspace, adoptSettings, adoptWorkspace, updateSettings, updateWorkspace };
}
