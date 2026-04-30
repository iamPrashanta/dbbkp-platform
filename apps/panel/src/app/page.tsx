"use client";

import { Activity, Database, Play, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import React, { useMemo, useState } from "react";
import { PipelineForm } from "@/components/PipelineForm";
import { PipelineTimeline } from "@/components/PipelineTimeline";
import { TerminalLogViewer } from "@/components/TerminalLogViewer";
import { trpc } from "@/utils/trpc";

type DashboardRun = NonNullable<ReturnType<typeof useDashboardData>["runs"][number]>;

function useDashboardData() {
  const query = trpc.pipeline.dashboard.useQuery(undefined, {
    refetchInterval: 4000,
    retry: false,
  });

  return {
    query,
    pipelines: query.data?.pipelines ?? [],
    runs: query.data?.recentRuns ?? [],
    summary: query.data?.summary ?? { pipelines: 0, active: 0, completed: 0, failed: 0 },
  };
}

export default function DashboardPage() {
  const utils = trpc.useContext();
  const { query, pipelines, runs, summary } = useDashboardData();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const selectedRun = useMemo(() => {
    if (selectedRunId) return runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;
    return runs[0] ?? null;
  }, [runs, selectedRunId]);

  const logQuery = trpc.pipeline.log.useQuery(
    { runId: selectedRun?.id ?? "" },
    {
      enabled: Boolean(selectedRun?.id),
      refetchInterval: selectedRun?.status === "active" || selectedRun?.status === "waiting" ? 4000 : false,
    },
  );

  const runPipeline = trpc.pipeline.run.useMutation({
    onSuccess: async (data) => {
      setSelectedRunId(data.runId);
      await utils.pipeline.dashboard.invalidate();
    },
  });

  const queryError = query.error as { data?: { code?: string } } | null;
  if (queryError?.data?.code === "UNAUTHORIZED") {
    return (
      <main className="auth-required">
        <div>
          <ShieldCheck size={28} />
          <h1>Sign in required</h1>
          <p>The panel is wired to protected tRPC procedures. Log in to load live jobs, pipelines, and logs.</p>
          <a className="btn btn-primary" href="/login">Open login</a>
        </div>
      </main>
    );
  }

  return (
    <main className="panel-container">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">DBBKP Control Plane</p>
          <h1>Pipeline Operations</h1>
          <p>Queue-backed runs, persistent job history, and live logs from isolated workers.</p>
        </div>
        <button className="btn" onClick={() => utils.pipeline.dashboard.invalidate()} disabled={query.isFetching}>
          <RefreshCw size={16} className={query.isFetching ? "spin" : ""} />
          Refresh
        </button>
      </header>

      <section className="metric-grid">
        <Metric icon={<Workflow size={18} />} label="Pipelines" value={summary.pipelines} />
        <Metric icon={<Activity size={18} />} label="Active Runs" value={summary.active} tone="active" />
        <Metric icon={<Database size={18} />} label="Completed" value={summary.completed} tone="good" />
        <Metric icon={<ShieldCheck size={18} />} label="Failed" value={summary.failed} tone="bad" />
      </section>

      <section className="ops-grid">
        <section className="pipelines-panel">
          <div className="section-heading">
            <div>
              <h2>Pipelines</h2>
              <p>Trigger a run and watch the worker pick it up</p>
            </div>
          </div>
          <div className="pipeline-list">
            {pipelines.length === 0 ? (
              <div className="empty-state">No pipelines configured.</div>
            ) : (
              pipelines.map((pipeline) => (
                <div className="pipeline-row" key={pipeline.id}>
                  <div>
                    <strong>{pipeline.name}</strong>
                    <span>{pipeline.repoUrl}</span>
                  </div>
                  <button
                    className="icon-btn run-btn"
                    title="Run pipeline"
                    disabled={runPipeline.isLoading || !pipeline.enabled}
                    onClick={() => runPipeline.mutate({ id: pipeline.id })}
                  >
                    <Play size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <PipelineForm onCreated={() => utils.pipeline.dashboard.invalidate()} />
      </section>

      <section className="runtime-grid">
        <PipelineTimeline
          runs={runs as DashboardRun[]}
          selectedId={selectedRun?.id}
          onSelect={(run) => setSelectedRunId(run.id)}
        />
        <TerminalLogViewer jobId={selectedRun?.bullJobId} initialLog={logQuery.data?.log ?? selectedRun?.log} />
      </section>
    </main>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "active" | "good" | "bad";
}) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
