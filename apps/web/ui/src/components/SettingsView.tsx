import { useState, type ReactNode } from "react";
import { MaoSegmented, MaoSelect } from "maotaui";

import { LANGS, setLang, useLangPref, useT } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";

interface Row {
  name: string;
  note?: string;
  control?: ReactNode;
}

interface Section {
  id: string;
  group: string;
  icon: string;
  label: string;
  rows: Row[];
}

export function SettingsView({
  info,
  theme,
  onTheme,
  onBack,
}: {
  info: AppInfo | null;
  theme: string;
  onTheme: (theme: string) => void;
  onBack: () => void;
}) {
  const lang = useLangPref();
  const t = useT();
  const [section, setSection] = useState("general");
  const [query, setQuery] = useState("");

  const sections: Section[] = [
    {
      id: "general",
      group: t("personal"),
      icon: ICON.sliders,
      label: t("general"),
      rows: [
        {
          name: t("language"),
          note: t("languageNote"),
          control: (
            <MaoSelect
              className="settings-lang"
              aria-label={t("language")}
              options={[{ value: "system", label: t("followSystem") }, ...LANGS]}
              value={lang}
              onChange={(event) => setLang(event.target.value)}
            />
          ),
        },
      ],
    },
    {
      id: "appearance",
      group: t("personal"),
      icon: ICON.art,
      label: t("personalization"),
      rows: [
        {
          name: t("appearance"),
          control: (
            <MaoSegmented
              label={t("appearance")}
              options={[
                { value: "system", label: t("followSystem") },
                { value: "dark", label: t("dark") },
                { value: "light", label: t("light") },
              ]}
              value={theme}
              onChange={onTheme}
            />
          ),
        },
      ],
    },
    {
      id: "about",
      group: t("system"),
      icon: ICON.plug,
      label: t("about"),
      rows: [...new Set(Object.values(info?.capabilities ?? {}).map((route) => route.plugin))]
        .sort()
        .map((plugin) => ({
          name: plugin,
          note: Object.entries(info?.capabilities ?? {})
            .filter(([, route]) => route.plugin === plugin)
            .map(([capability]) => capability)
            .join(" · "),
        })),
    },
  ];

  const needle = query.trim().toLowerCase();
  const hunting = needle !== "";
  const matches = (row: Row): boolean => `${row.name} ${row.note ?? ""}`.toLowerCase().includes(needle);
  const hits = sections
    .map((item) => ({
      section: item,
      rows: item.rows.some(matches) ? item.rows.filter(matches) : item.label.toLowerCase().includes(needle) ? item.rows : [],
    }))
    .filter((hit) => hit.rows.length > 0);
  const shown = sections.filter((item) => item.id === section);
  const groups = [...new Set(sections.map((item) => item.group))];

  const go = (id: string): void => {
    setSection(id);
    setQuery("");
  };

  return (
    <main className="settings">
      <aside className="settings-rail">
        <button type="button" className="settings-back" onClick={onBack}>
          <Icon d={ICON.back} className="icon icon-sm" />
          {t("backToApp")}
        </button>

        <div className="settings-search">
          <Icon d={ICON.search} className="icon icon-sm" />
          <input
            value={query}
            placeholder={t("searchSettings")}
            aria-label={t("searchSettings")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query === "" ? null : (
            <button type="button" className="settings-search-clear" title={t("clear")} aria-label={t("clear")} onClick={() => setQuery("")}>
              <Icon d={ICON.close} className="icon icon-sm" />
            </button>
          )}
        </div>

        {hunting ? (
          <div className="settings-hits">
            {hits.length === 0 ? <div className="settings-empty">{t("noMatch")}</div> : null}
            {hits.map((hit) => (
              <div key={hit.section.id}>
                <button type="button" className="settings-hit-head" onClick={() => go(hit.section.id)}>
                  <Icon d={hit.section.icon} className="icon icon-sm" />
                  {hit.section.label}
                </button>
                {hit.rows.map((row) => (
                  <button key={row.name} type="button" className="settings-hit" onClick={() => go(hit.section.id)}>
                    {row.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <nav className="settings-nav">
            {groups.map((group) => (
              <div key={group}>
                <div className="settings-group">{group}</div>
                {sections
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-nav-item${item.id === section ? " is-on" : ""}`}
                      onClick={() => setSection(item.id)}
                    >
                      <Icon d={item.icon} className="icon icon-sm" />
                      {item.label}
                    </button>
                  ))}
              </div>
            ))}
          </nav>
        )}
      </aside>

      <div className="settings-pane">
        {shown.map((item) => (
          <section key={item.id} className="settings-section">
            <h1 className="settings-title">{item.label}</h1>
            <div className="settings-card">
              {item.rows.map((row) => (
                <div key={row.name} className="settings-item">
                  <div className="settings-item-text">
                    <div className="settings-item-name">{row.name}</div>
                    {row.note === undefined ? null : <div className="settings-item-note">{row.note}</div>}
                  </div>
                  {row.control === undefined ? null : <div className="settings-item-control">{row.control}</div>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
