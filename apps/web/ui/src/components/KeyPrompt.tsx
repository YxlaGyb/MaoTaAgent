import { useState } from "react";

import { MaoButton, TextField } from "maotaui";

import { describe } from "../lib/errors.ts";
import { useT } from "../lib/i18n.ts";
import { call } from "../lib/rpc.ts";

export function KeyPrompt({ onSaved }: { onSaved: () => void }) {
  const t = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (busy || value.trim() === "") return;
    setBusy(true);
    setFailure(null);
    try {
      await call("settings.set_key", { api_key: value.trim() });
      setValue("");
      onSaved();
    } catch (error) {
      setFailure(describe(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="key-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextField
        type="password"
        value={value}
        placeholder="sk-…"
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />
      <MaoButton size="sm" disabled={busy || value.trim() === ""}>
        {busy ? t("saving") : t("save")}
      </MaoButton>
      {failure === null ? null : <span className="key-failure">{failure}</span>}
    </form>
  );
}
