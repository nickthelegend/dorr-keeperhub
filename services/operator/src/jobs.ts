/**
 * Long-running work, tracked in SQLite.
 *
 * A duel spans several Sepolia blocks, so the API starts a job and the UI polls
 * it. Jobs used to live in a JSON state file that was rewritten wholesale on
 * every mutation — the same store that let two operator processes erase each
 * other's records. They now share the one database everything else uses.
 */
import { randomBytes } from "node:crypto";
import { database } from "./mev/db.js";

export interface JobStepRecord {
  label: string;
  status: "running" | "complete" | "error";
  detail?: string;
  txHash?: string;
  ms?: number;
}

export interface Job {
  id: string;
  kind: "commit" | "execute" | "close" | "mev-duel";
  refId: string;
  status: "running" | "complete" | "error";
  steps: JobStepRecord[];
  error?: string;
  createdAt: string;
  completedAt?: string;
}

interface Row {
  id: string;
  kind: string;
  ref_id: string;
  status: string;
  steps: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

const toJob = (r: Row): Job => ({
  id: r.id,
  kind: r.kind as Job["kind"],
  refId: r.ref_id,
  status: r.status as Job["status"],
  steps: JSON.parse(r.steps) as JobStepRecord[],
  error: r.error ?? undefined,
  createdAt: r.created_at,
  completedAt: r.completed_at ?? undefined,
});

function write(job: Job): void {
  database()
    .query(
      `INSERT OR REPLACE INTO jobs (id, kind, ref_id, status, steps, error, created_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      job.id,
      job.kind,
      job.refId,
      job.status,
      JSON.stringify(job.steps),
      job.error ?? null,
      job.createdAt,
      job.completedAt ?? null,
    );
}

export function createJob(kind: Job["kind"], refId: string): Job {
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind,
    refId,
    status: "running",
    steps: [],
    createdAt: new Date().toISOString(),
  };
  write(job);
  return job;
}

export function jobStep(
  job: Job,
  label: string,
): { done: (patch?: { detail?: string; txHash?: string }) => void; fail: (detail: string) => void } {
  const step: JobStepRecord = { label, status: "running" };
  const startedAt = Date.now();
  job.steps.push(step);
  write(job);

  return {
    done: (patch) => {
      step.status = "complete";
      step.ms = Date.now() - startedAt;
      if (patch?.detail) step.detail = patch.detail;
      if (patch?.txHash) step.txHash = patch.txHash;
      write(job);
    },
    fail: (detail) => {
      step.status = "error";
      step.ms = Date.now() - startedAt;
      step.detail = detail;
      write(job);
    },
  };
}

export function completeJob(job: Job): void {
  job.status = "complete";
  job.completedAt = new Date().toISOString();
  write(job);
}

export function failJob(job: Job, error: string): void {
  job.status = "error";
  job.error = error;
  job.completedAt = new Date().toISOString();
  write(job);
}

export function getJob(id: string): Job | undefined {
  const row = database().query(`SELECT * FROM jobs WHERE id = ?`).get(id) as unknown as Row | null;
  return row ? toJob(row) : undefined;
}

/**
 * Fail any job left "running" by a previous process.
 *
 * A job only advances while the process that started it is alive, so one that
 * survives a restart can never complete — the UI would poll a spinner forever.
 */
export function reapOrphanedJobs(): number {
  const db = database();
  const rows = db.query(`SELECT * FROM jobs WHERE status = 'running'`).all() as unknown as Row[];
  for (const r of rows) {
    const job = toJob(r);
    job.status = "error";
    job.error = "interrupted — the operator restarted while this job was running";
    job.completedAt = new Date().toISOString();
    for (const s of job.steps) {
      if (s.status === "running") {
        s.status = "error";
        s.detail = "interrupted by an operator restart";
      }
    }
    write(job);
  }
  return rows.length;
}
