"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mevApi, type Job } from "@/lib/operator";

/** Everything fails soft: components render honest empty states on error. */

export function useMevStatus() {
  return useQuery({
    queryKey: ["mev", "status"],
    queryFn: mevApi.status,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
    retry: false,
  });
}

export function useMevLeaderboard() {
  return useQuery({
    queryKey: ["mev", "leaderboard"],
    queryFn: mevApi.leaderboard,
    refetchInterval: 5_000,
    // A duel spans minutes and people switch tabs while they wait; without this
    // the board freezes on whatever it showed when focus was lost.
    refetchIntervalInBackground: true,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useMevDuels(limit = 25) {
  return useQuery({
    queryKey: ["mev", "duels", limit],
    queryFn: () => mevApi.duels(limit),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useJob(jobId: string | undefined) {
  return useQuery<Job>({
    queryKey: ["mev", "job", jobId],
    queryFn: () => mevApi.job(jobId!),
    enabled: !!jobId,
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (job && job.status !== "running") return false;
      return 1_000;
    },
  });
}

export function useInvalidateMev() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["mev", "leaderboard"] });
    qc.invalidateQueries({ queryKey: ["mev", "duels", 25] });
    qc.invalidateQueries({ queryKey: ["mev", "agent"] });
  };
}
