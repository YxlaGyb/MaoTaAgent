import { useState, type ReactNode } from "react";
import { Select } from "maotaui";

import { LANGS, setLang, useLang, useT } from "../lib/i18n.ts";
import type { AppInfo } from "../lib/rpc.ts";
import { Icon, ICON } from "./Icon.tsx";
import { KeyPrompt } from "./KeyPrompt.tsx";
import { PERMISSION_OPTIONS } from "./PermissionPicker.tsx";

interface Row {
  value?: string;
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
  permission,
  onPermission,
  onKeySaved,
  onBack,
}: {
  info: AppInfo | null;
  permission: string;
  onPermission: (mode: string) => void;
  onKeySaved: () => void;
  onBack: () => void;
}) {
  const lang = useLang();
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
            <Select
              className="settings-lang"
              aria-label={t("language")}
              options={LANGS}
              value={lang}
              onChange={(event) => setLang(event.target.value)}
            />
          ),
        },
        {
          name: "API Key",
          note: t("keyNote"),
          control: info?.has_key === true ? <span className="settings-value">{t("configured")}</span> : <KeyPrompt onSaved={onKeySaved} />,
        },
      ],
    },
    {
      id: "permission",
      group: t("personal"),
      icon: ICON.shield,
      label: t("permission"),
      rows: PERMISSION_OPTIONS.map((option) => ({ value: option.value, name: t(option.name), note: t(option.note) })),
    },
    {
      id: "about",
      group: t("system"),
      icon: ICON.info,
      label: t("about"),
      rows: [
        { name: t("version"), control: <span className="settings-value">{info?.version ?? "—"}</span> },
        { name: t("sessionsDir"), note: info?.sessions_dir ?? "—" },
      ],
    },
  ];

  const needle = query.trim().toLowerCase();
  const matches = (row: Row): boolean => `${row.name} ${row.note ?? ""}`.toLowerCase().includes(needle);
  const hunting = needle !== "";
  const shown = hunting ? sections.filter((item) => item.rows.some(matches)) : sections.filter((item) => item.id === section);
  const nav = hunting ? sections.filter((item) => item.label.toLowerCase().includes(needle) || item.rows.some(matches)) : sections;

  const groups = [...new Set(nav.map((item) => item.group))];

  return (
    <main className="settings">
      <aside className="settings-rail">
        <button type="button" className="settings-back" onClick={onBack}>
          <Icon d={ICON.back} className="icon icon-sm" />
          {t("backToApp")}
        </button>

        <label className="settings-search">
          <Icon d={ICON.search} className="icon icon-sm" />
          <input
            value={query}
            placeholder={t("searchSettings")}
            aria-label={t("searchSettings")}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <nav className="settings-nav">
          {groups.map((group) => (
            <div key={group}>
              <div className="settings-group">{group}</div>
              {nav
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`settings-nav-item${item.id === section ? " is-on" : ""}`}
                    onClick={() => {
                      setSection(item.id);
                      setQuery("");
                    }}
                  >
                    <Icon d={item.icon} className="icon icon-sm" />
                    {item.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="settings-pane">
        {shown.length === 0 ? <div className="settings-empty">{t("noMatch")}</div> : null}
        {shown.map((item) => (
          <section key={item.id} className="settings-section">
            <h1 className="settings-title">{item.label}</h1>
            <div className="settings-card">
              {(hunting ? item.rows.filter(matches) : item.rows).map((row) => {
                const option = PERMISSION_OPTIONS.find((candidate) => candidate.value === row.value);
                if (option === undefined) {
                  return (
                    <div key={row.name} className="settings-item">
                      <div className="settings-item-text">
                        <div className="settings-item-name">{row.name}</div>
                        {row.note === undefined ? null : <div className="settings-item-note">{row.note}</div>}
                      </div>
                      {row.control === undefined ? null : <div className="settings-item-control">{row.control}</div>}
                    </div>
                  );
                }
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`option${option.value === permission ? " is-on" : ""}${option.tone}`}
                    aria-pressed={option.value === permission}
                    onClick={() => onPermission(option.value)}
                  >
                    <Icon d={option.icon} className="icon option-icon" />
                    <span className="option-text">
                      <span className="option-name">{row.name}</span>
                      <span className="option-note">{row.note}</span>
                    </span>
                    {option.value === permission ? <Icon d={ICON.check} className="icon icon-sm option-check" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
