import { useEffect, useRef, useState } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────
interface InfraReport {
  version: string;
  node: { id: string; hostname: string; ip: string; env: string };
  timestamp: number;
  system: {
    os: string; uptime_sec: number;
    cpu_usage_percent: number; memory_usage_percent: number;
    disk: { mount: string; usage_percent: number }[];
  };
  services: {
    webserver: { type: string; status: string };
    php: { version: string; mode: string };
    database: { type: string; version: string };
  };
  security: {
    risk_score: number; level: string;
    malware: { found: boolean; count: number; samples: any[] };
    permissions: { world_writable_dirs: number };
    exposed_files: string[];
  };
  attacks: { top_ips: any[]; suspicious_requests: number };
  actions: { quarantined_files: any[]; auto_fix_applied: boolean };
}

interface Job {
  id: string; _uid: string; queue: 'backup' | 'infra';
  name: string; data: any; result?: any;
  state: 'completed' | 'failed' | 'active' | 'waiting';
  failedReason?: string; timestamp: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function tryParse(v: any): any {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
}

function fmtUptime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function riskColor(score: number) {
  if (score > 50) return 'var(--danger)';
  if (score > 20) return 'var(--warning)';
  return 'var(--success)';
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub, bar, barColor }: {
  icon: string; label: string; value: string; sub?: string; bar?: number; barColor?: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div className="metric-body">
        <div className="metric-label">{label}</div>
        <div className="metric-value">{value}</div>
        {sub && <div className="metric-sub">{sub}</div>}
        {bar != null && (
          <div className="metric-bar">
            <div className="metric-bar-fill" style={{ width: `${Math.min(bar, 100)}%`, background: barColor ?? 'var(--accent)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceRow({ label, value, status }: { label: string; value: string; status?: string }) {
  const isOk = status === 'running';
  const dot = status ? (isOk ? '🟢' : '🔴') : '⚫';
  return (
    <div className="service-row">
      <span className="service-dot">{dot}</span>
      <span className="service-label">{label}</span>
      <span className="service-value">{value}</span>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="btn-copy" onClick={copy}>
      {copied ? '✓ Copied' : '⎘ Copy'}
    </button>
  );
}

// ─── Dashboard Panel ──────────────────────────────────────────────────────────
function Dashboard({ report, scanTime, scanning, onRescan }: {
  report: InfraReport | null; scanTime: number | null; scanning: boolean; onRescan: () => void;
}) {
  if (scanning && !report) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Running infrastructure scan…</p>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="dashboard-empty">
        <div style={{ fontSize: '3rem' }}>🖥️</div>
        <p>No scan data yet.</p>
        <button onClick={onRescan} disabled={scanning}>Run Infrastructure Scan</button>
      </div>
    );
  }

  const disks = (report.system?.disk ?? []).filter(d => typeof d.usage_percent === 'number');
  const rawJson = JSON.stringify(report, null, 2);

  return (
    <div className="dashboard">

      {/* ── Node Banner ── */}
      <div className="node-banner">
        <div className="node-banner-left">
          <span className="node-status-dot" />
          <div>
            <div className="node-hostname">{report.node?.hostname ?? '—'}</div>
            <div className="node-meta">{report.node?.ip} · {report.system?.os} · {report.node?.env}</div>
          </div>
        </div>
        <div className="node-banner-right">
          <span className="node-time">Last scan: {scanTime ? new Date(scanTime).toLocaleTimeString() : '—'}</span>
          <button className="btn-rescan" onClick={onRescan} disabled={scanning}>
            {scanning ? '⟳ Scanning…' : '⟳ Rescan'}
          </button>
        </div>
      </div>

      {/* ── Top Metrics ── */}
      <div className="metrics-grid">
        <MetricCard icon="🔥" label="CPU Usage"
          value={`${report.system?.cpu_usage_percent ?? 0}%`}
          bar={report.system?.cpu_usage_percent}
          barColor={report.system?.cpu_usage_percent > 80 ? 'var(--danger)' : 'var(--accent)'}
        />
        <MetricCard icon="💾" label="Memory Usage"
          value={`${report.system?.memory_usage_percent ?? 0}%`}
          bar={report.system?.memory_usage_percent}
          barColor={report.system?.memory_usage_percent > 80 ? 'var(--danger)' : '#8b5cf6'}
        />
        <MetricCard icon="⏱" label="Uptime"
          value={fmtUptime(report.system?.uptime_sec ?? 0)}
        />
        <MetricCard icon="🛡️" label="Risk Score"
          value={String(report.security?.risk_score ?? 0)}
          sub={report.security?.level?.toUpperCase()}
          bar={report.security?.risk_score}
          barColor={riskColor(report.security?.risk_score ?? 0)}
        />
      </div>

      {/* ── Middle Row ── */}
      <div className="mid-row">

        {/* Services */}
        <div className="panel">
          <div className="panel-title">🧩 Services</div>
          <ServiceRow label="Web Server" value={report.services?.webserver?.type ?? '—'} status={report.services?.webserver?.status} />
          <ServiceRow label="PHP" value={report.services?.php?.version ?? '—'} />
          <ServiceRow label="Database" value={`${report.services?.database?.type ?? '—'} ${report.services?.database?.version ?? ''}`.trim()} />
        </div>

        {/* Security */}
        <div className="panel">
          <div className="panel-title">🛡️ Security</div>
          <div className="sec-row">
            <span>Malware</span>
            <span style={{ color: report.security?.malware?.found ? 'var(--danger)' : 'var(--success)' }}>
              {report.security?.malware?.found ? `⚠ ${report.security.malware.count} found` : '✓ Clean'}
            </span>
          </div>
          <div className="sec-row">
            <span>777 Dirs</span>
            <span style={{ color: report.security?.permissions?.world_writable_dirs > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {report.security?.permissions?.world_writable_dirs ?? 0}
            </span>
          </div>
          <div className="sec-row">
            <span>Suspicious Reqs</span>
            <span style={{ color: report.attacks?.suspicious_requests > 0 ? 'var(--warning)' : 'var(--success)' }}>
              {report.attacks?.suspicious_requests ?? 0}
            </span>
          </div>
          {(report.security?.exposed_files?.length ?? 0) > 0 && (
            <div className="exposed-files">
              <div className="exposed-title">⚠ Exposed Files ({report.security.exposed_files.length})</div>
              {report.security.exposed_files.map((f, i) => (
                <div key={i} className="exposed-file">{f}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Disk ── */}
      {disks.length > 0 && (
        <div className="panel">
          <div className="panel-title">💿 Disk Usage</div>
          <div className="disk-grid">
            {disks.map((d, i) => (
              <div key={i} className="disk-entry">
                <div className="disk-entry-mount">{d.mount}</div>
                <div className="disk-entry-bar-row">
                  <div className="disk-entry-bar">
                    <div className="disk-entry-fill" style={{
                      width: `${Math.min(d.usage_percent, 100)}%`,
                      background: d.usage_percent > 80 ? 'var(--danger)' : d.usage_percent > 60 ? 'var(--warning)' : 'var(--success)',
                    }} />
                  </div>
                  <span className="disk-entry-pct">{d.usage_percent}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Raw JSON ── */}
      <div className="panel">
        <div className="panel-title-row">
          <div className="panel-title">📄 Raw Scan Output</div>
          <CopyButton text={rawJson} />
        </div>
        <pre className="raw-json">{rawJson}</pre>
      </div>
    </div>
  );
}

// ─── Job Detail Drawer ──────────────────────────────────────────────────────
function JobDrawer({ job, onClose }: { job: Job; onClose: () => void }) {
  const parsed = tryParse((job as any).result);
  const rawStr = JSON.stringify(parsed ?? (job as any).result ?? job.data, null, 2);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={e => e.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="drawer-title">{job.name} <span className="job-id">#{job.id}</span></div>
            <div className="drawer-sub">{new Date(job.timestamp).toLocaleString()} · <span className={`badge ${job.state}`}>{job.state}</span></div>
          </div>
          <button className="btn-copy" onClick={onClose} style={{ fontSize: '.85rem', padding: '.35rem .7rem' }}>✕</button>
        </div>

        {parsed?.system && (
          <div className="drawer-section">
            <div className="drawer-section-title">💻 System</div>
            <div className="drawer-stats">
              {[['CPU', `${parsed.system.cpu_usage_percent}%`, parsed.system.cpu_usage_percent, 'var(--accent)'],
                ['Memory', `${parsed.system.memory_usage_percent}%`, parsed.system.memory_usage_percent, '#8b5cf6'],
              ].map(([l, v, b, c]: any) => (
                <div key={l} className="drawer-stat-card">
                  <div className="metric-label">{l}</div>
                  <div className="metric-value" style={{ fontSize: '1.2rem' }}>{v}</div>
                  <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${Math.min(b, 100)}%`, background: c }} /></div>
                </div>
              ))}
              <div className="drawer-stat-card">
                <div className="metric-label">Uptime</div>
                <div className="metric-value" style={{ fontSize: '1rem', marginTop: '.2rem' }}>{fmtUptime(parsed.system.uptime_sec)}</div>
              </div>
              {parsed.system.os && (
                <div className="drawer-stat-card">
                  <div className="metric-label">OS</div>
                  <div className="metric-value" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>{parsed.system.os}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {parsed?.security && (
          <div className="drawer-section">
            <div className="drawer-section-title">🛡️ Security</div>
            <div className="sec-row">
              <span>Risk Score</span>
              <span style={{ color: riskColor(parsed.security.risk_score), fontWeight: 700 }}>
                {parsed.security.risk_score} — {parsed.security.level?.toUpperCase()}
              </span>
            </div>
            <div className="sec-row">
              <span>Malware</span>
              <span style={{ color: parsed.security.malware?.found ? 'var(--danger)' : 'var(--success)' }}>
                {parsed.security.malware?.found ? `⚠ ${parsed.security.malware.count} found` : '✓ Clean'}
              </span>
            </div>
            {(parsed.security.exposed_files?.length ?? 0) > 0 && (
              <div className="exposed-files" style={{ marginTop: '.5rem' }}>
                <div className="exposed-title">⚠ Exposed ({parsed.security.exposed_files.length})</div>
                {parsed.security.exposed_files.map((f: string, i: number) => (
                  <div key={i} className="exposed-file">{f}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {(parsed?.disk ?? parsed?.system?.disk)?.filter((d: any) => typeof d.usage_percent === 'number').length > 0 && (
          <div className="drawer-section">
            <div className="drawer-section-title">💿 Disk</div>
            <div className="disk-grid">
              {(parsed.disk ?? parsed.system?.disk).filter((d: any) => typeof d.usage_percent === 'number').map((d: any, i: number) => (
                <div key={i} className="disk-entry">
                  <div className="disk-entry-mount">{d.mount}</div>
                  <div className="disk-entry-bar-row">
                    <div className="disk-entry-bar">
                      <div className="disk-entry-fill" style={{
                        width: `${Math.min(d.usage_percent, 100)}%`,
                        background: d.usage_percent > 80 ? 'var(--danger)' : d.usage_percent > 60 ? 'var(--warning)' : 'var(--success)',
                      }} />
                    </div>
                    <span className="disk-entry-pct">{d.usage_percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
            <div className="drawer-section-title" style={{ margin: 0 }}>📄 Raw Output</div>
            <CopyButton text={rawStr} />
          </div>
          <pre className="raw-json" style={{ maxHeight: '260px' }}>{rawStr}</pre>
        </div>
      </div>
    </div>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────
function JobCard({ job, onClick }: { job: Job; onClick: () => void }) {
  const isInfra = job.queue === 'infra';
  const target = isInfra ? 'localhost' : `${job.data?.db?.DB_NAME || '—'} @ ${job.data?.db?.DB_HOST || 'localhost'}`;
  const parsed = tryParse((job as any).result);
  const cpu = parsed?.system?.cpu_usage_percent ?? parsed?.cpu_usage_percent;
  const mem = parsed?.system?.memory_usage_percent ?? parsed?.memory_usage_percent;
  const score = parsed?.security?.risk_score;
  const hasResult = job.state === 'completed';

  return (
    <div className={`job-card ${hasResult ? 'job-card-clickable' : ''}`} onClick={hasResult ? onClick : undefined}>
      <div className="job-info" style={{ flex: 1, minWidth: 0 }}>
        <div className="job-card-top">
          <span>{isInfra ? '🖥' : '🗄'}</span>
          <h3 className="job-name">{job.name} <span className="job-id">#{job.id}</span></h3>
          <span className={`badge ${job.state}`}>{job.state}</span>
        </div>
        <div className="job-meta">{target} · {new Date(job.timestamp).toLocaleString()}</div>
        {isInfra && job.state === 'completed' && (cpu != null || score != null) && (
          <div className="job-quick-stats">
            {cpu != null && <span className="quick-stat">CPU {cpu}%</span>}
            {mem != null && <span className="quick-stat">MEM {mem}%</span>}
            {score != null && <span className="quick-stat" style={{ color: riskColor(score) }}>Risk {score}</span>}
          </div>
        )}
        {job.failedReason && <div className="job-error">{job.failedReason}</div>}
      </div>
      {hasResult && <span className="job-arrow">›</span>}
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────
type Tab = 'dashboard' | 'jobs';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<InfraReport | null>(null);
  const [scanTime, setScanTime] = useState<number | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const scanJobId = useRef<string | null>(null);

  // ── Fetch & merge all jobs ──
  const fetchJobs = async (): Promise<Job[]> => {
    const [bRes, iRes] = await Promise.all([
      fetch('http://localhost:3000/api/backup/jobs').catch(() => ({ ok: false, json: async () => [] })),
      fetch('http://localhost:3000/api/infra/jobs').catch(() => ({ ok: false, json: async () => [] })),
    ]);
    const bRaw: any[] = bRes.ok ? await bRes.json() : [];
    const iRaw: any[] = iRes.ok ? await iRes.json() : [];

    const seen = new Set<string>();
    const merged: Job[] = [];
    for (const j of [...bRaw.map(j => ({ ...j, queue: 'backup', _uid: `b_${j.id}` })),
                      ...iRaw.map(j => ({ ...j, queue: 'infra',  _uid: `i_${j.id}` }))]) {
      if (!seen.has(j._uid)) { seen.add(j._uid); merged.push(j as Job); }
    }
    merged.sort((a, b) => b.timestamp - a.timestamp);
    setJobs(merged);
    setError(bRes.ok || iRes.ok ? null : 'Control Plane Offline');
    setLoading(false);
    return merged;
  };

  // ── Trigger a scan, then poll for result ──
  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('http://localhost:3000/api/infra/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to queue scan');
      const { jobId } = await res.json();
      scanJobId.current = jobId;
    } catch (e) {
      setScanning(false);
    }
  };

  // ── On mount: fetch jobs, pick latest completed scan, auto-trigger if none ──
  useEffect(() => {
    fetchJobs().then((initialJobs) => {
      const latestScan = initialJobs.find(j => j.name === 'infra-scan' && j.state === 'completed');
      if (latestScan) {
        const parsed = tryParse((latestScan as any).result);
        if (parsed?.node) { setReport(parsed); setScanTime(latestScan.timestamp); }
        else { runScan(); }
      } else {
        runScan();
      }
    });
  }, []);

  // ── Poll every 3s; resolve pending scan ──
  useEffect(() => {
    const iv = setInterval(async () => {
      const all = await fetchJobs();

      if (scanJobId.current && scanning) {
        const target = all.find(j => j.queue === 'infra' && String(j.id) === String(scanJobId.current));
        if (target?.state === 'completed') {
          const parsed = tryParse((target as any).result);
          if (parsed?.node) { setReport(parsed); setScanTime(target.timestamp); }
          setScanning(false);
          scanJobId.current = null;
        } else if (target?.state === 'failed') {
          setScanning(false);
          scanJobId.current = null;
        }
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [scanning]);

  const completedCount = jobs.filter(j => j.state === 'completed').length;
  const failedCount = jobs.filter(j => j.state === 'failed').length;

  return (
    <div className="container">
      {selectedJob && <JobDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />}
      {/* ── Header ── */}
      <header>
        <div>
          <h1>DBBKP Platform</h1>
          <div className="header-sub">Infrastructure Orchestration Control Plane</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`pulse${error ? ' pulse-red' : ''}`} />
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {error ?? 'Operational'}
          </span>
        </div>
      </header>

      {/* ── Tab Bar ── */}
      <div className="tab-bar">
        <button className={`tab ${tab === 'dashboard' ? 'tab-active' : ''}`} onClick={() => setTab('dashboard')}>
          🖥️ Dashboard
        </button>
        <button className={`tab ${tab === 'jobs' ? 'tab-active' : ''}`} onClick={() => setTab('jobs')}>
          📋 Jobs
          <span className="tab-count">{jobs.length}</span>
        </button>
        <div style={{ flex: 1 }} />
        <div className="stats-row">
          <span className="stat-pill stat-pill-ok">{completedCount} <span>ok</span></span>
          <span className="stat-pill stat-pill-fail">{failedCount} <span>failed</span></span>
        </div>
      </div>

      {/* ── Dashboard Tab ── */}
      {tab === 'dashboard' && (
        <Dashboard report={report} scanTime={scanTime} scanning={scanning} onRescan={runScan} />
      )}

      {/* ── Jobs Tab ── */}
      {tab === 'jobs' && (
        <>
          <div className="action-bar">
            <div className="action-group">
              <span className="action-label">Database</span>
              <div className="action-buttons">
                <button onClick={() => fetch('http://localhost:3000/api/backup/seed/pgsql', { method: 'POST', headers: { 'Content-Type': 'application/json' } }).then(fetchJobs)} style={{ background: 'linear-gradient(135deg,var(--success),#059669)' }}>🌱 Seed DB</button>
                <button onClick={() => fetch('http://localhost:3000/api/backup/pgsql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ DB_HOST: 'localhost', DB_USER: 'gui_test_user', DB_PASS: 'testpass', DB_NAME: 'gui_db' }) }).then(fetchJobs)}>💾 Test Backup</button>
              </div>
            </div>
            <div className="action-divider" />
            <div className="action-group">
              <span className="action-label">Infrastructure</span>
              <div className="action-buttons">
                {(['health-check','disk','network','scan'] as const).map(m => (
                  <button key={m}
                    onClick={() => fetch(`http://localhost:3000/api/infra/${m}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).then(fetchJobs)}
                    style={m === 'health-check' ? { background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }
                         : m === 'disk'         ? { background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)' }
                         : m === 'network'      ? { background: 'linear-gradient(135deg,#06b6d4,#0891b2)' }
                         :                        { background: 'linear-gradient(135deg,#ef4444,#dc2626)' }}>
                    {m === 'health-check' ? '❤️ Health' : m === 'disk' ? '💾 Disk' : m === 'network' ? '🌐 Network' : '🛡️ Full Scan'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="glass-panel">
            <h2 style={{ marginBottom: '1.25rem', fontSize: '1rem' }}>Job Timeline</h2>
            {loading ? (
              <div className="empty-state">Connecting…</div>
            ) : jobs.length === 0 ? (
              <div className="empty-state">No jobs yet.</div>
            ) : (
              <div className="jobs-grid">
                {jobs.map(j => <JobCard key={j._uid} job={j} onClick={() => setSelectedJob(j)} />)}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
