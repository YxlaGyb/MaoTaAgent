export interface ExitStatus {
  ok: boolean;
  label: string;
}

export function parseExitStatus(result: {
  exit_code: number | null;
  signal?: string | null;
  timed_out?: boolean;
}): ExitStatus {
  if (result.timed_out === true) return { ok: false, label: "timed out" };
  if (result.exit_code === 0) return { ok: true, label: "exit 0" };
  if (typeof result.exit_code === "number") return { ok: false, label: `exit ${result.exit_code}` };
  if (typeof result.signal === "string" && result.signal !== "") {
    return { ok: false, label: `killed by ${result.signal}` };
  }
  return { ok: false, label: "no exit status" };
}