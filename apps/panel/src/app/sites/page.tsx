"use client";

import React from "react";
import { Globe, Plus, ExternalLink, Activity, Terminal, Trash2 } from "lucide-react";
import Link from "next/link";
import { trpc } from "@/utils/trpc";

export default function SitesPage() {
  const query = trpc.sites.list.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const deleteMutation = trpc.sites.delete.useMutation();

  return (
    <main className="panel-container">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Cloud Hosting</p>
          <h1>Websites & Apps</h1>
          <p>Manage your domains, runtimes, and deployment status.</p>
        </div>
        <Link href="/sites/create" className="btn btn-primary">
          <Plus size={16} />
          Create Website
        </Link>
      </header>

      <div className="sites-grid">
        {query.isLoading ? (
          <div className="empty-state">Loading sites...</div>
        ) : query.data?.length === 0 ? (
          <div className="empty-state">No sites deployed yet.</div>
        ) : (
          query.data?.map((site) => (
            <div key={site.id} className="site-card glass">
              <div className="site-card-header">
                <div className="site-info">
                  <h3>{site.domain}</h3>
                  <span className="runtime-badge">{site.type}</span>
                </div>
                <div className={`status-pill ${site.status}`}>
                  {site.status}
                </div>
              </div>

              <div className="site-meta">
                <div className="meta-item">
                  <Activity size={14} />
                  <span>Port: {site.port || "N/A"}</span>
                </div>
                <div className="meta-item">
                  <Terminal size={14} />
                  <span>{site.source === "git" ? "GitHub" : "Upload"}</span>
                </div>
              </div>

              <div className="site-actions">
                <a 
                  href={`http://${site.domain}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn btn-sm"
                >
                  <ExternalLink size={14} />
                  Visit
                </a>
                <Link href={`/sites/${site.id}`} className="btn btn-sm">
                  Manage
                </Link>
                <button 
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    if (confirm(`Delete site ${site.domain}? This cannot be undone.`)) {
                      await deleteMutation.mutateAsync({ id: site.id });
                      query.refetch();
                    }
                  }}
                  disabled={deleteMutation.isLoading}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .sites-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
          gap: 1.5rem;
        }
        .site-card {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .site-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .site-info h3 {
          font-size: 1.1rem;
          margin-bottom: 0.25rem;
        }
        .runtime-badge {
          font-size: 0.75rem;
          color: var(--text-muted);
          text-transform: uppercase;
          background: rgba(255, 255, 255, 0.05);
          padding: 2px 6px;
          border-radius: 4px;
        }
        .site-meta {
          display: flex;
          gap: 1rem;
          font-size: 0.85rem;
          color: var(--text-muted);
        }
        .meta-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .site-actions {
          display: flex;
          gap: 0.75rem;
          margin-top: auto;
        }
        .btn-sm {
          padding: 0.4rem 0.75rem;
          font-size: 0.85rem;
        }
      `}</style>
    </main>
  );
}
