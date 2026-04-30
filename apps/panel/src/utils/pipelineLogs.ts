"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type TerminalLine = {
  id: number;
  type: "log" | "error" | "done" | "system";
  message: string;
  ts: number;
};

const MAX_LINES = 1000;

function wsBaseUrl() {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  return apiUrl.replace(/^http/, "ws");
}

export function usePipelineLogs(jobId?: string | null, initialLog?: string | null) {
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "closed">("idle");
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const counter = useRef(0);

  const initialLines = useMemo(() => {
    if (!initialLog) return [];
    return initialLog
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_LINES)
      .map((message) => ({
        id: counter.current++,
        type: "log" as const,
        message,
        ts: Date.now(),
      }));
  }, [initialLog]);

  useEffect(() => {
    setLines(initialLines);
  }, [initialLines]);

  useEffect(() => {
    if (!jobId) {
      setStatus("idle");
      return;
    }

    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let attempts = 0;

    const append = (line: Omit<TerminalLine, "id">) => {
      setLines((current) => {
        const next = [...current, { ...line, id: counter.current++ }];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    };

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      socket = new WebSocket(`${wsBaseUrl()}/ws/logs?jobId=${encodeURIComponent(jobId)}`);

      socket.onopen = () => {
        attempts = 0;
        setStatus("open");
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const chunks = String(payload.message ?? "").split(/\r?\n/).filter(Boolean);
          for (const message of chunks) {
            append({
              type: payload.type === "error" || payload.type === "done" ? payload.type : "log",
              message,
              ts: payload.ts ?? Date.now(),
            });
          }
        } catch {
          append({ type: "log", message: String(event.data), ts: Date.now() });
        }
      };

      socket.onclose = () => {
        setStatus("closed");
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** attempts, 8000);
        attempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        append({ type: "system", message: "Log socket error, reconnecting...", ts: Date.now() });
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [jobId]);

  return { lines, status };
}
