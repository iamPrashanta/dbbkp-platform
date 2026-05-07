"use client";

import { useEffect, useRef, useState } from "react";
import { sendWsMessage } from "@/utils/ws";

interface TerminalProps {
  containerId: string;
  siteId?: string;
  onClose?: () => void;
}

/**
 * Full xterm.js terminal connected to the WS gateway PTY bridge.
 * Lazy-loads xterm to avoid SSR issues (Next.js).
 */
export default function Terminal({ containerId, siteId, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<any>(null);
  const fitRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");

  useEffect(() => {
    if (!containerRef.current) return;

    let ws: WebSocket | null = null;
    let term: any = null;

    async function init() {
      // Dynamic import — avoids Next.js SSR crash
      const { Terminal: XTerm } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      const { WebLinksAddon } = await import("@xterm/addon-web-links");

      term = new XTerm({
        cursorBlink: true,
        theme: {
          background: "#0d0d0d",
          foreground: "#e0e0e0",
          cursor: "#00d4aa",
          selectionBackground: "#00d4aa33",
          black: "#000000",
          red: "#ff5555",
          green: "#50fa7b",
          yellow: "#f1fa8c",
          blue: "#6272a4",
          magenta: "#ff79c6",
          cyan: "#8be9fd",
          white: "#f8f8f2",
          brightBlack: "#555555",
          brightRed: "#ff6e6e",
          brightGreen: "#69ff94",
          brightYellow: "#ffffa5",
          brightBlue: "#d6acff",
          brightMagenta: "#ff92df",
          brightCyan: "#a4ffff",
          brightWhite: "#ffffff",
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 13,
        lineHeight: 1.4,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());
      termRef.current = term;
      fitRef.current = fitAddon;

      term.open(containerRef.current!);
      fitAddon.fit();

      // Handle stdin → WS
      term.onData((data: string) => {
        if (sessionIdRef.current) {
          sendWsMessage({
            type: "terminal.input",
            id: sessionIdRef.current,
            data,
          });
        }
      });

      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (sessionIdRef.current) {
          sendWsMessage({ type: "terminal.resize", id: sessionIdRef.current, cols, rows });
        }
      });

      term.writeln("\x1b[36m⬢ dbbkp Terminal\x1b[0m  Connecting...");
    }

    init();

    // Listen for messages from the unified WS gateway
    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        // Gateway opened a terminal session
        if (msg.type === "terminal.opened") {
          sessionIdRef.current = msg.sessionId;
          setStatus("open");
          termRef.current?.writeln("\r\x1b[32m✔ Connected\x1b[0m");
          termRef.current?.clear();
        }

        // Receive stdout from PTY
        if (msg.channel === "terminal" && msg.id === sessionIdRef.current) {
          termRef.current?.write(msg.payload.data);
        }

        // Terminal closed
        if (msg.type === "terminal.closed") {
          setStatus("closed");
          termRef.current?.writeln("\r\n\x1b[31m[Session ended]\x1b[0m");
        }
      } catch {}
    };

    // We hook into the singleton WS from ws.ts
    // The gateway WS is already maintained globally; we read from it here
    const token = localStorage.getItem("dbbkp_token");
    const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000"}/ws?token=${token}`;
    ws = new WebSocket(wsUrl);
    ws.addEventListener("message", handleMessage);

    ws.addEventListener("open", () => {
      // Request terminal session
      ws!.send(JSON.stringify({ type: "terminal.open", id: containerId, siteId }));
    });

    ws.addEventListener("close", () => setStatus("closed"));

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitRef.current?.fit();
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      // Close session
      if (sessionIdRef.current && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "terminal.close", id: sessionIdRef.current }));
      }
      ws?.close();
      term?.dispose();
      resizeObserver.disconnect();
    };
  }, [containerId, siteId]);

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] rounded-xl overflow-hidden border border-white/10">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#111111] border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === "open" ? "bg-green-400 animate-pulse" :
            status === "closed" ? "bg-red-400" : "bg-yellow-400 animate-pulse"
          }`} />
          <span className="text-xs text-white/60 font-mono">
            {status === "open" ? `shell · ${containerId.slice(0, 12)}` :
             status === "connecting" ? "connecting..." : "disconnected"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { fitRef.current?.fit(); }}
            className="text-xs text-white/40 hover:text-white/80 transition-colors"
            title="Resize"
          >
            ⊞
          </button>
          <button
            onClick={onClose}
            className="text-xs text-white/40 hover:text-red-400 transition-colors"
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      {/* xterm.js mount point */}
      <div ref={containerRef} className="flex-1 w-full p-1" style={{ minHeight: 0 }} />
    </div>
  );
}
