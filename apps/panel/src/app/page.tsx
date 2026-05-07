"use client";

import {
  Activity,
  Database,
  Play,
  RefreshCw,
  ShieldCheck,
  Workflow,
  Trash2,
  Server,
  Globe,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import React, { useMemo } from "react";
import { trpc } from "@/utils/trpc";

function usePlatformData() {
  const pipelineQuery = trpc.pipeline.dashboard.useQuery(undefined, {
    refetchInterval: 5000,
  });
  
  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const infraQuery = trpc.infra.jobs.useQuery(undefined, {
    refetchInterval: 10000,
  });

  return {
    pipelineQuery,
    sitesQuery,
    infraQuery,
    isFetching: pipelineQuery.isFetching || sitesQuery.isFetching || infraQuery.isFetching,
    pipelines: pipelineQuery.data?.pipelines ?? [],
    sites: sitesQuery.data ?? [],
    infraJobs: infraQuery.data ?? [],
    summary: pipelineQuery.data?.summary ?? { pipelines: 0, active: 0, completed: 0, failed: 0 },
  };
}

export default function DashboardPage() {
  const utils = trpc.useContext();
  const { pipelineQuery, sitesQuery, infraQuery, isFetching, pipelines, sites, infraJobs, summary } = usePlatformData();

  const runInfraScan = trpc.infra.scan.useMutation({
    onSuccess: () => utils.infra.jobs.invalidate(),
  });

  const runPipeline = trpc.pipeline.run.useMutation({
    onSuccess: () => utils.pipeline.dashboard.invalidate(),
  });

  // Calculate Mock/Real Security Score from latest infra job
  const latestScan = infraJobs.find(j => j.name === "infra-scan" && j.state === "completed");
  const riskScore = latestScan?.result?.score ?? 0;
  
  const refreshAll = () => {
    utils.pipeline.dashboard.invalidate();
    utils.sites.list.invalidate();
    utils.infra.jobs.invalidate();
  };

  const queryError = pipelineQuery.error as { data?: { code?: string } } | null;
  if (queryError?.data?.code === "UNAUTHORIZED") {
    return (
      <main className="auth-required">
        <div className="glass-panel">
          <ShieldCheck size={32} className="text-active" />
          <h1>Authentication Required</h1>
          <p>Access to the DBBKP Control Plane requires an active session.</p>
          <a className="btn btn-primary" href="/login">Sign In</a>
        </div>
      </main>
    );
  }

  return (
    <main className="panel-container">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">DBBKP Control Plane</p>
          <h1>Platform Overview</h1>
          <p>Unified PaaS management, security enforcement, and deployment orchestration.</p>
        </div>
        <button className="btn" onClick={refreshAll} disabled={isFetching}>
          <RefreshCw size={16} className={isFetching ? "spin text-active" : ""} />
          Refresh
        </button>
      </header>

      <section className="metric-grid">
        <Metric 
          icon={<Globe size={22} />} 
          label="Active Sites" 
          value={sites.length} 
          tone="active" 
        />
        <Metric 
          icon={<Workflow size={22} />} 
          label="Pipelines" 
          value={pipelines.length} 
          tone="purple" 
        />
        <Metric 
          icon={<Server size={22} />} 
          label="Server Health" 
          value="Online" 
          tone="good" 
        />
        <Metric 
          icon={<ShieldCheck size={22} />} 
          label="Security Risk" 
          value={riskScore > 0 ? `${riskScore}/100` : "Low"} 
          tone={riskScore > 50 ? "bad" : riskScore > 20 ? "warning" : "good"} 
        />
      </section>

      <div className="dashboard-grid">
        {/* Sites Panel */}
        <section className="glass-panel">
          <div className="section-heading">
            <div>
              <h2>Hosted Sites</h2>
              <p>Applications currently routed via Traefik</p>
            </div>
            <a href="/sites" className="btn">Manage</a>
          </div>
          <div className="list-container">
            {sites.length === 0 ? (
              <div className="empty-state">
                <Globe size={32} />
                <p>No sites configured</p>
              </div>
            ) : (
              sites.slice(0, 5).map((site) => (
                <div className="list-row" key={site.id}>
                  <div className="row-info">
                    <strong>{site.domain}</strong>
                    <span>{site.type} runtime • port {site.port || "N/A"}</span>
                  </div>
                  <div className="row-meta">
                    <span className={`badge ${site.status === "running" ? "badge-success" : "badge-warning"}`}>
                      {site.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Security & Infra Panel */}
        <section className="glass-panel">
          <div className="section-heading">
            <div>
              <h2>Security & Infrastructure</h2>
              <p>Real-time threat monitoring and OS-level scans</p>
            </div>
            <button 
              className="btn btn-primary" 
              onClick={() => runInfraScan.mutate({ mode: "full" })}
              disabled={runInfraScan.isLoading}
            >
              <ShieldCheck size={16} />
              Scan Now
            </button>
          </div>
          <div className="list-container">
            {infraJobs.length === 0 ? (
              <div className="empty-state">
                <Server size={32} />
                <p>No infra scans executed yet</p>
              </div>
            ) : (
              infraJobs.slice(0, 4).map((job) => (
                <div className="list-row" key={job.id}>
                  <div className="row-info">
                    <strong>{job.name === "infra-scan" ? "Deep Security Scan" : "Health Check"}</strong>
                    <span>{new Date(job.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="row-meta">
                    {job.state === "completed" ? (
                      <span className="badge badge-success"><CheckCircle2 size={12}/> Clean</span>
                    ) : job.state === "failed" ? (
                      <span className="badge badge-error"><AlertTriangle size={12}/> Failed</span>
                    ) : (
                      <span className="badge badge-active spin"><RefreshCw size={12}/> Running</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="full-grid">
        {/* Pipelines Panel */}
        <section className="glass-panel">
          <div className="section-heading">
            <div>
              <h2>CI/CD Deployment Pipelines</h2>
              <p>Git-driven automated builds and deployments</p>
            </div>
            <a href="/pipelines" className="btn">View All</a>
          </div>
          <div className="list-container">
            {pipelines.length === 0 ? (
              <div className="empty-state">
                <Workflow size={32} />
                <p>No pipelines configured.</p>
              </div>
            ) : (
              pipelines.map((pipeline) => (
                <div className="list-row" key={pipeline.id}>
                  <div className="row-info">
                    <strong>{pipeline.name}</strong>
                    <span>{pipeline.repoUrl}</span>
                  </div>
                  <div className="row-actions">
                    <button
                      className="btn text-success"
                      title="Run pipeline"
                      disabled={runPipeline.isLoading || !pipeline.enabled}
                      onClick={() => runPipeline.mutate({ id: pipeline.id })}
                    >
                      <Play size={16} /> Deploy
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

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
  value: number | string;
  tone?: "neutral" | "active" | "good" | "bad" | "warning" | "purple";
}) {
  return (
    <div className={`metric glass-panel ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
