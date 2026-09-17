import { writeSync } from "node:fs";

export function frameReader(onFrame: (body: Buffer) => void): (chunk: Buffer) => void {
  let buffer: Buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      const head = buffer.indexOf("\r\n\r\n");
      if (head < 0) return;
      const length = contentLength(buffer.subarray(0, head));
      if (length === null) throw new Error("frame has no Content-Length");
      if (buffer.length < head + 4 + length) return;
      const body = buffer.subarray(head + 4, head + 4 + length);
      buffer = buffer.subarray(head + 4 + length);
      onFrame(body);
    }
  };
}

function contentLength(head: Buffer): number | null {
  for (const line of head.toString("latin1").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== "content-length") continue;
    const value = Number(line.slice(colon + 1).trim());
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return null;
}

export function writeFrame(frame: unknown): void {
  const body = Buffer.from(JSON.stringify(frame), "utf8");
  writeSync(1, `Content-Length: ${body.length}\r\n\r\n`);
  writeSync(1, body);
}