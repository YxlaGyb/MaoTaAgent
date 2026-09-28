export type JobStatus = "running" | "stopping" | "completed" | "failed" | "killed";

export interface JobView {
  id: string;
  kind: string;
  label: string;
  owner?: string;
  status: JobStatus;
  progress?: string;
  detail?: string;
  result?: string;
  created_at: string;
  started_at: string;
  ended_at?: string;
}

export interface JobChunk {
  channel?: string;
  text: string;
  at: number;
}

export interface JobRead {
  chunks: JobChunk[];
  lossy: boolean;
  result?: string;
  job: JobView;
}

export interface JobSettledEvent extends JobView {
  cause: "producer" | "kill" | "teardown";
  awaited: boolean;
}