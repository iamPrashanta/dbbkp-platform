"use client";

import { useState, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useWsChannel } from "@/utils/ws";

interface MetricPoint {
  ts: number;
  time: string;
  cpu: number;
  memory: number;
  disk: number;
}

interface NodeMetricsChartProps {
  nodeId: string;
  nodeName?: string;
  maxPoints?: number;
}

const CHART_COLORS = {
  cpu: "#00d4aa",
  memory: "#a78bfa",
  disk: "#f59e0b",
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-1 bg-white/5 rounded-lg px-4 py-3 min-w-[100px]">
      <span className="text-[10px] text-white/40 uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-1">
        <span className="text-2xl font-bold" style={{ color }}>{value}</span>
        <span className="text-xs text-white/40 mb-0.5">%</span>
      </div>
      {/* Mini usage bar */}
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

export default function NodeMetricsChart({
  nodeId,
  nodeName,
  maxPoints = 60,
}: NodeMetricsChartProps) {
  const [data, setData] = useState<MetricPoint[]>([]);
  const [latest, setLatest] = useState<MetricPoint | null>(null);

  useWsChannel(
    "metrics",
    nodeId,
    useCallback(
      (payload: { cpu: number; memory: number; disk: number; ts: number }) => {
        const point: MetricPoint = {
          ts: payload.ts,
          time: new Date(payload.ts).toLocaleTimeString("en-US", { hour12: false }),
          cpu: Math.round(payload.cpu ?? 0),
          memory: Math.round(payload.memory ?? 0),
          disk: Math.round(payload.disk ?? 0),
        };
        setLatest(point);
        setData((prev) => [...prev, point].slice(-maxPoints));
      },
      [maxPoints]
    )
  );

  return (
    <div className="flex flex-col gap-4 bg-[#111] rounded-xl p-4 border border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${data.length > 0 ? "bg-green-400 animate-pulse" : "bg-white/20"}`} />
          <span className="text-sm font-medium text-white/80">
            {nodeName ?? "Node"} · Live Metrics
          </span>
        </div>
        <span className="text-xs text-white/30 font-mono">
          {data.length > 0
            ? new Date(data[data.length - 1].ts).toLocaleTimeString()
            : "waiting..."}
        </span>
      </div>

      {/* Stat cards */}
      <div className="flex gap-3 flex-wrap">
        <StatCard label="CPU" value={latest?.cpu ?? 0} color={CHART_COLORS.cpu} />
        <StatCard label="Memory" value={latest?.memory ?? 0} color={CHART_COLORS.memory} />
        <StatCard label="Disk" value={latest?.disk ?? 0} color={CHART_COLORS.disk} />
      </div>

      {/* Area chart */}
      <div className="h-40">
        {data.length < 2 ? (
          <div className="h-full flex items-center justify-center text-xs text-white/20">
            Collecting data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
              <defs>
                {Object.entries(CHART_COLORS).map(([key, color]) => (
                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  background: "#1a1a1a",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: "rgba(255,255,255,0.8)",
                }}
                formatter={(value: number, name: string) => [`${value}%`, name.toUpperCase()]}
              />
              <Area type="monotone" dataKey="cpu" stroke={CHART_COLORS.cpu} fill={`url(#grad-cpu)`} strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="memory" stroke={CHART_COLORS.memory} fill={`url(#grad-memory)`} strokeWidth={1.5} dot={false} />
              <Area type="monotone" dataKey="disk" stroke={CHART_COLORS.disk} fill={`url(#grad-disk)`} strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
