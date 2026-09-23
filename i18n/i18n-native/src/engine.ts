/// Finding the plugins that own words, and asking them for what they own. The
/// capability table is the only registry there is: a plugin contributes by
/// providing an `i18n.<namespace>` capability, and nothing is registered or
/// unregistered anywhere.
///
/// A contributor that cannot answer is skipped with a warning rather than
/// taken as one. An interface missing a namespace shows a key where a sentence
/// belonged, which a person can see and report; an interface that refused to
/// start because one plugin's words were malformed cannot be used at all.

import {
  isI18nCapability,
  namespaceOf,
  readI18nDescription,
  readI18nWords,
  type I18nContribution,
  type Messages,
} from "@maota/i18n-protocol";
import type { Channel, Route } from "@maota/plugin-kit";

export interface I18nProvider {
  capability: string;
  namespace: string;
  locales: string[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function providerCapabilities(capabilities: Record<string, Route>): string[] {
  return Object.keys(capabilities).filter(isI18nCapability).sort();
}

export async function describeProviders(
  channel: Channel,
  capabilities: Record<string, Route>,
  signal: AbortSignal,
): Promise<I18nProvider[]> {
  const found: I18nProvider[] = [];
  for (const capability of providerCapabilities(capabilities)) {
    try {
      const described = readI18nDescription(await channel.call(capability, "describe", {}, { signal }));
      if (described === null) {
        channel.log("warn", `${capability} has no usable describe; skipped`, { capability });
        continue;
      }
      found.push({ capability, namespace: namespaceOf(capability), locales: described.locales });
    } catch (error) {
      channel.log("warn", `${capability} could not be described; skipped`, { capability, error: messageOf(error) });
    }
  }
  return found;
}

/// Ask every described contributor for its words. A language it did not declare
/// is dropped, because a contributor whose two answers disagree is a mistake in
/// the plugin rather than something to guess about, and the rest of its words
/// are still worth having.
export async function collectContributions(
  channel: Channel,
  capabilities: Record<string, Route>,
  signal: AbortSignal,
): Promise<I18nContribution[]> {
  const found: I18nContribution[] = [];
  for (const provider of await describeProviders(channel, capabilities, signal)) {
    let messages: Record<string, Messages> | null = null;
    try {
      messages = readI18nWords(await channel.call(provider.capability, "catalog", {}, { signal }));
    } catch (error) {
      channel.log("warn", `${provider.capability} could not be read; skipped`, {
        capability: provider.capability,
        error: messageOf(error),
      });
      continue;
    }
    if (messages === null) {
      channel.log("warn", `${provider.capability} answered no readable words; skipped`, {
        capability: provider.capability,
      });
      continue;
    }
    const kept: Record<string, Messages> = {};
    for (const locale of provider.locales) {
      const words = messages[locale];
      if (words === undefined) {
        channel.log("warn", `${provider.capability} declared ${locale} but answered nothing for it`, {
          capability: provider.capability,
          locale,
        });
        continue;
      }
      kept[locale] = words;
    }
    for (const locale of Object.keys(messages)) {
      if (!provider.locales.includes(locale)) {
        channel.log("warn", `${provider.capability} answered ${locale}, which it never declared`, {
          capability: provider.capability,
          locale,
        });
      }
    }
    if (Object.keys(kept).length > 0) found.push({ namespace: provider.namespace, messages: kept });
  }
  return found;
}
