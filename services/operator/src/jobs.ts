import { randomBytes } from "node:crypto";
import { getState, persist, type Job } from "./state.js";

export function createJob(kind: Job["kind"], refId: string): Job {
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind,
    refId,
    status: "running",
    steps: [],
    createdAt: new Date().toISOString(),
  };
  getState().jobs.push(job);
  persist();
  return job;
}

export function jobStep(job: Job, label: string): { done: (patch?: { detail?: string; txHash?: string }) => void; fail: (detail: string) => void } {
  const step: Job["steps"][number] = { label, status: "running" };
  const startedAt = Date.now();
  job.steps.push(step);
  persist();
  return {
    done: (patch) => {
      step.status = "complete";
      step.ms = Date.now() - startedAt;
      if (patch?.detail) step.detail = patch.detail;
      if (patch?.txHash) step.txHash = patch.txHash;
      persist();
    },
    fail: (detail) => {
      step.status = "error";
      step.ms = Date.now() - startedAt;
      step.detail = detail;
      persist();
    },
  };
}

export function completeJob(job: Job): void {
  job.status = "complete";
  job.completedAt = new Date().toISOString();
  persist();
}

export function failJob(job: Job, error: string): void {
  job.status = "error";
  job.error = error;
  job.completedAt = new Date().toISOString();
  persist();
}

export function getJob(id: string): Job | undefined {
  return getState().jobs.find((j) => j.id === id);
}

/**
 * Fail any job left "running" by a previous process.
 *
 * A job only advances while the process that started it is alive, so one that
 * survives a restart in `running` can never complete. The UI polls until the
 * status changes, so it spins forever on a spinner that will never resolve —
 * which looks like a hung operation rather than an interrupted one. Call this
 * once at startup, before serving.
 */
export function reapOrphanedJobs(): number {
  const orphans = getState().jobs.filter((j) => j.status === "running");
  for (const job of orphans) {
    job.status = "error";
    job.error = "interrupted — the operator restarted while this job was running";
    job.completedAt = new Date().toISOString();
    for (const step of job.steps) {
      if (step.status === "running") {
        step.status = "error";
        step.detail = "interrupted by an operator restart";
      }
    }
  }
  if (orphans.length) persist();
  return orphans.length;
}
