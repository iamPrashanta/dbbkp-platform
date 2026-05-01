"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/utils/trpc";
import { 
  Globe, 
  Activity, 
  Cpu, 
  HardDrive, 
  Trash2, 
  ExternalLink, 
  ChevronLeft,
  Terminal,
  Shield,
  Loader2
} from "lucide-react";
import Link from "next/link";

export default function SiteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const { data: site, isLoading: isSiteLoading } = trpc.sites.get.useQuery({ id });
  const { data: stats, refetch: refetchStats } = trpc.sites.stats.useQuery(
    { id }, 
    { 
      enabled: !!site?.pm2Name,
      refetchInterval: 3000 
    }
  );

  const deleteMutation = trpc.sites.delete.useMutation({
    onSuccess: () => router.push("/sites"),
  });

  if (isSiteLoading) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin" size={40} />
      </div>
    );
  }

  if (!site) return <div className="empty-state">Site not found.</div>;

  const memoryMB = stats ? Math.round(stats.memoryUsed / 1024 / 1024) : 0;
  const memoryLimitMB = stats ? Math.round(stats.memoryLimit / 1024 / 1024) : 0;

  return (
    <main className="panel-container">
      <header className="detail-header">
        <Link href="/sites" className="back-link">
          <ChevronLeft size={16} />
          Back to Sites
        </Link>
        <div className="header-main">
          <div className="header-info">
            <div className="domain-pill">
              <Globe size={18} />
              <h1>{site.domain}</h1>
            </div>
            <div className="header-meta">
              <span className="runtime-badge">{site.type}</span>
              <span className={`status-pill ${site.status}`}>{site.status}</span>
            </div>
          </div>
          <div className="header-actions">
            <a 
              href={`http://${site.domain}`} 
              target="_blank" 
              className="btn btn-primary"
            >
              <ExternalLink size={16} />
              Open Website
            </a>
            <button 
              className="btn btn-danger"
              onClick={() => {
                if (confirm("Permanently delete this website?")) {
                  deleteMutation.mutate({ id: site.id });
                }
              }}
              disabled={deleteMutation.isLoading}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="site-layout">
        <section className="stats-section">
          <h2>Resource Monitoring</h2>
          <div className="stats-grid">
            <div className="stat-card glass">
              <div className="stat-icon cpu">
                <Cpu size={20} />
              </div>
              <div className="stat-content">
                <label>CPU Usage</label>
                <div className="stat-value">{stats?.cpu.toFixed(1) ?? 0}%</div>
                <div className="usage-bar">
                  <div 
                    className="usage-progress" 
                    style={{ width: `${stats?.cpu ?? 0}%`, background: getUsageColor(stats?.cpu ?? 0) }} 
                  />
                </div>
              </div>
            </div>

            <div className="stat-card glass">
              <div className="stat-icon ram">
                <Activity size={20} />
              </div>
              <div className="stat-content">
                <label>Memory (RAM)</label>
                <div className="stat-value">
                  {memoryMB} MB <span>/ {memoryLimitMB} MB</span>
                </div>
                <div className="usage-bar">
                  <div 
                    className="usage-progress" 
                    style={{ width: `${stats?.ram ?? 0}%`, background: getUsageColor(stats?.ram ?? 0) }} 
                  />
                </div>
              </div>
            </div>

            <div className="stat-card glass">
              <div className="stat-icon disk">
                <HardDrive size={20} />
              </div>
              <div className="stat-content">
                <label>Environment</label>
                <div className="stat-value">{site.type === 'static' ? 'Nginx' : 'Docker'}</div>
                <p className="stat-subtext">Isolation: Containerized</p>
              </div>
            </div>
          </div>

          <div className="graph-container glass">
             <div className="graph-header">
                <h3>System Load (Legacy UI)</h3>
                <div className="graph-legend">
                   <span className="dot cpu"></span> CPU
                   <span className="dot ram"></span> RAM
                </div>
             </div>
             <div className="graph-placeholder">
                <MockGraph cpu={stats?.cpu ?? 0} ram={stats?.ram ?? 0} />
             </div>
          </div>
        </section>

        <section className="info-section">
          <div className="info-card glass">
            <h3>Configuration</h3>
            <div className="info-list">
              <div className="info-row">
                <label>Site ID</label>
                <span>{site.id}</span>
              </div>
              <div className="info-row">
                <label>Port</label>
                <span>{site.port || "N/A (Static)"}</span>
              </div>
              <div className="info-row">
                <label>Document Root</label>
                <code>{site.docRoot}</code>
              </div>
              <div className="info-row">
                <label>Source</label>
                <span>{site.source === 'git' ? 'GitHub Repository' : 'ZIP Upload'}</span>
              </div>
            </div>
          </div>

          <div className="info-card glass">
            <h3>Security</h3>
            <div className="security-status">
               <Shield size={20} className="text-good" />
               <div>
                  <strong>SSL / TLS Active</strong>
                  <p>Certificate managed by DBBKP Edge</p>
               </div>
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .loading-screen {
          height: 80vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .detail-header {
          margin-bottom: 2.5rem;
        }
        .back-link {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--text-muted);
          font-size: 0.9rem;
          margin-bottom: 1rem;
          transition: color 0.2s;
        }
        .back-link:hover { color: var(--text); }
        .header-main {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 2rem;
        }
        .domain-pill {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.5rem;
        }
        .domain-pill h1 {
          font-size: 2.25rem;
          font-weight: 800;
          letter-spacing: -0.04em;
        }
        .header-meta {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .header-actions {
          display: flex;
          gap: 1rem;
        }
        .site-layout {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 2rem;
        }
        .stats-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 1.5rem;
        }
        .stat-card {
          padding: 1.5rem;
          display: flex;
          gap: 1.25rem;
          align-items: flex-start;
        }
        .stat-icon {
          width: 44px;
          height: 44px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .stat-icon.cpu { background: rgba(59, 130, 246, 0.1); color: #3b82f6; }
        .stat-icon.ram { background: rgba(16, 185, 129, 0.1); color: #10b981; }
        .stat-icon.disk { background: rgba(139, 92, 246, 0.1); color: #8b5cf6; }
        
        .stat-content { flex: 1; }
        .stat-content label {
          display: block;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          margin-bottom: 0.25rem;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.75rem;
        }
        .stat-value span { font-size: 0.9rem; color: var(--text-muted); font-weight: 400; }
        
        .usage-bar {
          height: 6px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
          overflow: hidden;
        }
        .usage-progress {
          height: 100%;
          transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .stat-subtext { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; }

        .graph-container {
          padding: 1.5rem;
          height: 300px;
          display: flex;
          flex-direction: column;
        }
        .graph-header {
           display: flex;
           justify-content: space-between;
           align-items: center;
           margin-bottom: 1.5rem;
        }
        .graph-legend { display: flex; gap: 1rem; font-size: 0.8rem; }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
        .dot.cpu { background: #3b82f6; }
        .dot.ram { background: #10b981; }
        .graph-placeholder { flex: 1; position: relative; }

        .info-section {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .info-card { padding: 1.5rem; }
        .info-card h3 { font-size: 1rem; margin-bottom: 1.25rem; }
        .info-list { display: flex; flex-direction: column; gap: 1rem; }
        .info-row {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .info-row label { font-size: 0.75rem; color: var(--text-muted); }
        .info-row span { font-size: 0.95rem; }
        .info-row code { font-size: 0.85rem; color: var(--primary); }

        .security-status {
           display: flex;
           gap: 1rem;
           align-items: center;
           padding: 1rem;
           background: rgba(16, 185, 129, 0.05);
           border-radius: var(--radius);
        }
        .security-status strong { display: block; font-size: 0.95rem; }
        .security-status p { font-size: 0.8rem; color: var(--text-muted); }

        @media (max-width: 1024px) {
          .site-layout { grid-template-columns: 1fr; }
          .header-main { flex-direction: column; align-items: flex-start; gap: 1.5rem; }
        }
      `}</style>
    </main>
  );
}

function getUsageColor(percent: number) {
  if (percent < 60) return "#3b82f6";
  if (percent < 85) return "#f59e0b";
  return "#ef4444";
}

function MockGraph({ cpu, ram }: { cpu: number, ram: number }) {
  // Simple CSS-based bar graph simulation for 'Legacy UI' look
  return (
    <div className="mock-graph">
       {[...Array(20)].map((_, i) => (
         <div key={i} className="graph-column">
            <div 
              className="bar ram" 
              style={{ height: `${Math.random() * 20 + ram}%`, opacity: 0.3 + (i / 30) }} 
            />
            <div 
              className="bar cpu" 
              style={{ height: `${Math.random() * 20 + cpu}%`, opacity: 0.5 + (i / 20) }} 
            />
         </div>
       ))}
       <style jsx>{`
          .mock-graph {
             height: 100%;
             width: 100%;
             display: flex;
             align-items: flex-end;
             gap: 4px;
             padding-bottom: 20px;
             border-bottom: 1px solid rgba(255,255,255,0.1);
          }
          .graph-column {
             flex: 1;
             display: flex;
             flex-direction: column;
             justify-content: flex-end;
             gap: 2px;
             height: 100%;
          }
          .bar {
             width: 100%;
             border-radius: 2px 2px 0 0;
             transition: height 1s ease;
          }
          .bar.cpu { background: #3b82f6; }
          .bar.ram { background: #10b981; }
       `}</style>
    </div>
  );
}
