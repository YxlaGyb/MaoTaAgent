import { useT } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";

export function PluginsView({ info }: { info: AppInfo | null }) {
  const t = useT();
  const byPlugin = new Map<string, string[]>();
  for (const [capability, route] of Object.entries(info?.capabilities ?? {})) {
    byPlugin.set(route.plugin, [...(byPlugin.get(route.plugin) ?? []), capability]);
  }
  const names = [...byPlugin.keys()].sort();

  return (
    <main className="chat">
      <header className="chat-head">
        <span className="chat-title">{t("plugins")}</span>
      </header>
      <div className="plugins-body">
        {names.length === 0 ? (
          <div className="settings-empty">{t("noMatch")}</div>
        ) : (
          <div className="settings-card">
            {names.map((plugin) => (
              <div key={plugin} className="settings-item">
                <div className="settings-item-text">
                  <div className="settings-item-name">{plugin}</div>
                  <div className="settings-item-note">{(byPlugin.get(plugin) ?? []).join(" · ")}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
