"use client";
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineTimeline = PipelineTimeline;
const lucide_react_1 = require("lucide-react");
function formatDuration(ms) {
    if (!ms)
        return "-";
    const seconds = Math.max(1, Math.round(ms / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function StatusIcon({ status }) {
    if (status === "completed")
        return <lucide_react_1.CheckCircle2 size={17} className="status-completed"/>;
    if (status === "failed")
        return <lucide_react_1.XCircle size={17} className="status-failed"/>;
    if (status === "active")
        return <lucide_react_1.Loader2 size={17} className="status-active spin"/>;
    if (status === "waiting")
        return <lucide_react_1.Clock3 size={17} className="status-waiting"/>;
    return <lucide_react_1.Circle size={17}/>;
}
function PipelineTimeline({ runs, selectedId, onSelect }) {
    return (<section className="timeline">
      <div className="section-heading">
        <div>
          <h2>Job Timeline</h2>
          <p>Recent pipeline activity from the database mirror</p>
        </div>
      </div>

      <div className="timeline-list">
        {runs.length === 0 ? (<div className="empty-state">No pipeline runs yet.</div>) : (runs.map((run) => (<button key={run.id} className={`timeline-row ${selectedId === run.id ? "selected" : ""}`} onClick={() => onSelect(run)}>
              <div className="timeline-marker">
                <StatusIcon status={run.status}/>
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
            </button>)))}
      </div>
    </section>);
}
