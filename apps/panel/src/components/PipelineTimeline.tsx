"use client";

import { CheckCircle2, Circle, Clock3, Loader2, XCircle } from "lucide-react";

type Run = {
  id: string;
  status: string;
  bullJobId: string | null;
  createdAt: string | Date | null;
  startedAt?: string | Date | null;
  finishedAt: string | Date | null;
  durationMs?: number | null;
  runner?: string | null;
  image?: string | null;
  error?: string | null;
  pipeline?: { name: string; repoUrl: string; branch: string | null } | null;
};

type Props = {
  runs: Run[];
  selectedId?: string | null;
  onSelect: (run: Run) => void;
};

function formatDuration(ms?: number | null) {
  if (!ms) return "-";
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 size={17} className="status-completed" />;
  if (status === "failed") return <XCircle size={17} className="status-failed" />;
  if (status === "active") return <Loader2 size={17} className="status-active spin" />;
  if (status === "waiting") return <Clock3 size={17} className="status-waiting" />;
  return <Circle size={17} />;
}

export function PipelineTimeline({ runs, selectedId, onSelect }: Props) {
  return (
    <section className="timeline">
      <div className="section-heading">
        <div>
          <h2>Job Timeline</h2>
          <p>Recent pipeline activity from the database mirror</p>
        </div>
      </div>

      <div className="timeline-list">
        {runs.length === 0 ? (
          <div className="empty-state">No pipeline runs yet.</div>
        ) : (
          runs.map((run) => (
            <button key={run.id} className={`timeline-row ${selectedId === run.id ? "selected" : ""}`} onClick={() => onSelect(run)}>
              <div className="timeline-marker">
                <StatusIcon status={run.status} />
              </div>
              <div className="timeline-body">
                <div className="timeline-topline">
                  <strong>{run.pipeline?.name ?? "Pipeline"}</strong>
                  <span className={`status-pill ${run.status}`}>{run.status}</span>
                </div>
                <div className="timeline-meta">
                  <span>{run.pipeline?.branch ?? "main"}</span>
                  <span>{run.runner ?? "docker"}</span>
                  {run.image ? <span>{run.image}</span> : null}
                  <span>{formatDuration(run.durationMs)}</span>
                </div>
                {run.error ? <p className="timeline-error">{run.error}</p> : null}
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
