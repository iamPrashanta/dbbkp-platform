"use client";

import { useEffect, useRef, useState } from "react";
import { useWsChannel } from "@/utils/ws";

interface ContainerLogsProps {
  containerId: string;
  containerName?: string;
  maxLines?: number;
}

interface LogLine {
  line: string;
  ts: number;
  id: number;
}

export default function ContainerLogs({
  containerId,
  containerName,
  maxLines = 2000,
}: ContainerLogsProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineCounter = useRef(0);

  useWsChannel("containers", containerId, (payload: { line: string; ts: number }) => {
    setLines((prev) => {
      const next = [
        ...prev,
        { line: payload.line, ts: payload.ts, id: lineCounter.current++ },
      ].slice(-maxLines);
      return next;
    });
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  const filtered = filter
    ? lines.filter((l) => l.line.toLowerCase().includes(filter.toLowerCase()))
    : lines;

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  };

  // ANSI color stripping for clean display (full ANSI renderer would be xterm.js)
  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "");

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] rounded-xl overflow-hidden border border-white/10">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-white/60 font-mono">
            {containerName ?? containerId.slice(0, 12)} · {lines.length} lines
          </span>
        </div>
        <div className="flex items-center gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70 w-36 focus:outline-none focus:border-white/30"
          />
          <button
            onClick={() => setLines([])}
            className="text-xs text-white/40 hover:text-white/80 transition-colors"
            title="Clear"
          >
            Clear
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`text-xs transition-colors ${autoScroll ? "text-green-400" : "text-white/40 hover:text-white/80"}`}
            title="Auto-scroll"
          >
            ↓ Auto
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 font-mono text-xs leading-5 text-green-300/90 space-y-0.5"
        style={{ minHeight: 0 }}
      >
        {filtered.length === 0 ? (
          <div className="text-white/20 text-center mt-8">
            {filter ? "No lines match filter" : "Waiting for log output..."}
          </div>
        ) : (
          filtered.map((l) => (
            <div key={l.id} className="flex gap-3 hover:bg-white/5 px-1 rounded group">
              <span className="text-white/20 flex-shrink-0 select-none">
                {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className="break-all whitespace-pre-wrap">{stripAnsi(l.line)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
