import React from "react";

export default function DashboardPage() {
  return (
    <main className="panel-container">
      <header style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "1.8rem", fontWeight: "700" }}>System Overview</h1>
          <p style={{ color: "var(--text-muted)", marginTop: "0.4rem" }}>
            Real-time infrastructure health and performance
          </p>
        </div>
        <div style={{ display: "flex", gap: "1rem" }}>
          <button className="btn">📜 Logs</button>
          <button className="btn btn-primary">⚡ Rescan</button>
        </div>
      </header>

      <div className="card-grid">
        <StatCard label="CPU Usage" value="12.4%" trend="+2.1%" status="healthy" />
        <StatCard label="Memory" value="34.8%" trend="-0.5%" status="healthy" />
        <StatCard label="Disk usage" value="87%" trend="Warning" status="warning" />
        <StatCard label="Risk Score" value="20" trend="Low" status="healthy" />
      </div>

      <section style={{ marginTop: "3rem" }}>
        <h2 style={{ fontSize: "1.2rem", marginBottom: "1.5rem" }}>Active Services</h2>
        <div className="glass" style={{ padding: "1rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                <th style={{ padding: "1rem" }}>Service</th>
                <th style={{ padding: "1rem" }}>Status</th>
                <th style={{ padding: "1rem" }}>Uptime</th>
                <th style={{ padding: "1rem" }}>Version</th>
              </tr>
            </thead>
            <tbody style={{ fontSize: "0.95rem" }}>
              <ServiceRow name="PostgreSQL" status="running" uptime="12d 4h" version="16.2" />
              <ServiceRow name="Redis" status="running" uptime="12d 4h" version="7.2" />
              <ServiceRow name="Nginx" status="stopped" uptime="-" version="1.24" />
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, trend, status }: any) {
  return (
    <div className="glass" style={{ padding: "1.5rem" }}>
      <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: "700", marginBottom: "0.5rem" }}>{value}</div>
      <div style={{ fontSize: "0.8rem", color: status === "warning" ? "var(--error)" : "var(--success)" }}>
        {status === "warning" ? "⚠️" : "↑"} {trend}
      </div>
    </div>
  );
}

function ServiceRow({ name, status, uptime, version }: any) {
  return (
    <tr style={{ borderTop: "1px solid var(--border)" }}>
      <td style={{ padding: "1rem", fontWeight: "500" }}>{name}</td>
      <td style={{ padding: "1rem" }}>
        <span className={`badge ${status === "running" ? "badge-success" : "badge-error"}`}>
          {status}
        </span>
      </td>
      <td style={{ padding: "1rem", color: "var(--text-muted)" }}>{uptime}</td>
      <td style={{ padding: "1rem", color: "var(--text-muted)" }}>{version}</td>
    </tr>
  );
}
