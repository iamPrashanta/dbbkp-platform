"use client";

import { Copy, Check, Pause, Play, RotateCcw, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePipelineLogs } from "@/utils/pipelineLogs";

type Props = {
  jobId?: string | null;
  initialLog?: string | null;
};

export function TerminalLogViewer({ jobId, initialLog }: Props) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { lines, status } = usePipelineLogs(jobId, initialLog);

  const copyLogs = () => {
    const text = lines.map(l => `[${new Date(l.ts).toLocaleTimeString()}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [autoScroll, lines]);

  return (
    <section className="terminal-shell">
      <div className="terminal-toolbar">
        <div className="terminal-title">
          <Terminal size={16} />
          <span>Live Logs</span>
          <span className={`connection-dot ${status}`} />
        </div>
        <div className="terminal-actions">
          <button className="icon-btn" title="Copy logs" onClick={copyLogs}>
            {copied ? <Check size={15} className="text-good" /> : <Copy size={15} />}
          </button>
          <button className="icon-btn" title={autoScroll ? "Pause auto-scroll" : "Resume auto-scroll"} onClick={() => setAutoScroll((value) => !value)}>
            {autoScroll ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button className="icon-btn" title="Jump to bottom" onClick={() => {
            if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          }}>
            <RotateCcw size={15} />
          </button>
        </div>
      </div>
      <div ref={viewportRef} className="terminal-viewport">
        {lines.length === 0 ? (
          <div className="terminal-empty">Waiting for pipeline output...</div>
        ) : (
          lines.map((line) => (
            <pre key={line.id} className={`terminal-line ${line.type}`}>
              <span>{new Date(line.ts).toLocaleTimeString()}</span>
              {line.message}
            </pre>
          ))
        )}
      </div>
    </section>
  );
}
