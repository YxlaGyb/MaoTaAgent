import type { JobChunk, JobRead, JobView } from "./types.ts";

interface StoredChunk extends JobChunk {
  offset: number;
}

export class OutputRing {
  private chunks: StoredChunk[] = [];
  private total = 0;
  private cursor = 0;
  private resultDelivered = false;
  private result?: string;

  append(text: string, channel?: string, gapBefore?: boolean): void {
    if (text === "") return;
    const offset = this.total;
    this.total += Buffer.byteLength(text, "utf8");
    if (gapBefore === true && this.chunks.length > 0) {
      this.chunks.push({ offset, text: "", channel, at: Date.now() });
    }
    this.chunks.push({ offset, text, channel, at: Date.now() });
  }

  trim(limit: number): void {
    while (this.bytes() > limit && this.chunks.length > 1) this.chunks.shift();
    if (this.bytes() > limit && this.chunks.length === 1) {
      const only = this.chunks[0]!;
      const bytes = Buffer.from(only.text, "utf8");
      only.text = bytes.subarray(Math.max(0, bytes.length - limit)).toString("utf8");
      only.offset = Math.max(only.offset, this.total - limit);
    }
  }

  read(job: JobView): JobRead {
    const first = this.chunks[0]?.offset ?? this.total;
    const lossy = this.cursor < first;
    const chunks = this.chunks
      .filter((chunk) => chunk.offset + Buffer.byteLength(chunk.text, "utf8") > this.cursor)
      .filter((chunk) => chunk.text !== "")
      .map((chunk) => ({ ...(chunk.channel === undefined ? {} : { channel: chunk.channel }), text: chunk.text, at: chunk.at }));
    this.cursor = this.total;
    const result = this.resultDelivered ? undefined : this.result;
    this.resultDelivered = true;
    return { chunks, lossy, ...(result === undefined ? {} : { result }), job };
  }

  settle(result: string | undefined, limit: number): void {
    this.result = result;
    this.trim(limit);
  }

  isResultPending(): boolean {
    return !this.resultDelivered;
  }

  bytes(): number {
    return this.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.text, "utf8"), 0);
  }
}