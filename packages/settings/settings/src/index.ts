#!/usr/bin/env node
import { CallError, isPluginEntry, runPlugin, type Definition } from "@maota/plugin-kit";

import {
  emptySettings,
  readLocale,
  readSettingsFile,
  readSettingsFileAt,
  readTheme,
  requireRevision,
  storeSettings,
  writeSettingsFile,
  type SettingsStore,
  type SettingsView,
} from "./store.ts";

let settings: SettingsStore = storeSettings({});

function patchOf(current: SettingsView, raw: unknown): SettingsView {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CallError(-32602, "settings.update patch must be an object");
  }
  const patch = raw as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    if (key !== "locale" && key !== "theme") throw new CallError(-32602, `unknown settings field: ${key}`);
  }
  const next: SettingsView = {
    revision: current.revision,
    locale: "locale" in patch ? readLocale(patch.locale, current.locale) : current.locale,
    theme: "theme" in patch ? readTheme(patch.theme, current.theme) : current.theme,
  };
  if (next.locale === current.locale && next.theme === current.theme) return current;
  return { ...next, revision: current.revision + 1 };
}

function selfCheck(): string[] {
  const problems: string[] = [];
  const empty = emptySettings();
  if (empty.locale !== null || empty.theme !== null || empty.revision !== 0) problems.push("empty settings are wrong");
  if (readLocale(undefined, null) !== null) problems.push("an absent locale should stay absent");
  if (readLocale("zh-CN", null) !== "zh-CN") problems.push("a locale was not kept");
  if (readLocale("system", null) !== "system") problems.push("system locale was not kept");
  if (readTheme("dark", null) !== "dark") problems.push("a theme was not kept");
  try {
    readLocale("not a locale", null);
    problems.push("a malformed locale was accepted");
  } catch {
  }
  const value = readSettingsFile({ revision: 2, locale: "en", theme: "light" });
  if (value.revision !== 2 || value.locale !== "en" || value.theme !== "light") problems.push("a settings document was read wrong");
  const applied = patchOf(empty, { locale: "zh-CN" });
  if (applied.locale !== "zh-CN" || applied.revision !== 1) problems.push("a settings patch was not applied");
  return problems;
}

export const definition: Definition = {
  provides: ["settings"],
  injects: [],
  registrations: [],
  hostCalls: [],
  configKeys: ["file"],

  setup(wiring) {
    settings = storeSettings(wiring.config);
  },

  methods: {
    get() {
      return readSettingsFileAt(settings);
    },

    async update(params, ctx) {
      const current = readSettingsFileAt(settings);
      requireRevision(current, params?.expected_revision);
      const next = patchOf(current, params?.patch ?? {});
      if (next.revision === current.revision) return current;
      writeSettingsFile(settings, next);
      await ctx.channel.publish("settings.changed", next);
      return next;
    },
  },

  selfCheck,
};

if (isPluginEntry(import.meta.url)) runPlugin(definition);
