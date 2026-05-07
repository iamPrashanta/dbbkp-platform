"use client";

import { useEffect, useRef, useCallback } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000";

type MessageHandler = (msg: any) => void;

/**
 * A singleton WebSocket manager.
 * All components share ONE connection, multiplexed by channel.
 */

interface SocketState {
  ws: WebSocket | null;
  handlers: Map<string, Set<MessageHandler>>;
  reconnectTimer: NodeJS.Timeout | null;
}

const state: SocketState = {
  ws: null,
  handlers: new Map(),
  reconnectTimer: null,
};

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("dbbkp_token");
    return raw ?? null;
  } catch {
    return null;
  }
}

function connect() {
  const token = getToken();
  if (!token) return;

  const url = `${WS_URL}/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  state.ws = ws;

  ws.onopen = () => {
    console.log("[WS] Connected to gateway");
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const key = msg.channel && msg.id ? `${msg.channel}:${msg.id}` : msg.type ?? "__global__";
      const handlers = state.handlers.get(key);
      if (handlers) {
        for (const handler of handlers) handler(msg);
      }
      // Also deliver to global listeners
      const global = state.handlers.get("__global__");
      if (global) {
        for (const handler of global) handler(msg);
      }
    } catch {}
  };

  ws.onclose = () => {
    console.warn("[WS] Disconnected — reconnecting in 3s...");
    state.ws = null;
    if (!state.reconnectTimer) {
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connect();
      }, 3000);
    }
  };

  ws.onerror = (err) => {
    console.error("[WS] Error:", err);
  };
}

function ensureConnected() {
  if (!state.ws || state.ws.readyState === WebSocket.CLOSED) {
    connect();
  }
}

export function sendWsMessage(msg: object) {
  ensureConnected();
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(msg));
  } else {
    // Queue for when the connection opens
    const tryAgain = () => {
      if (state.ws?.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(msg));
        state.ws.removeEventListener("open", tryAgain);
      }
    };
    state.ws?.addEventListener("open", tryAgain);
  }
}

function addHandler(key: string, handler: MessageHandler) {
  if (!state.handlers.has(key)) state.handlers.set(key, new Set());
  state.handlers.get(key)!.add(handler);
}

function removeHandler(key: string, handler: MessageHandler) {
  state.handlers.get(key)?.delete(handler);
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Subscribe to a channel:id stream */
export function useWsChannel(
  channel: string,
  id: string | null,
  onMessage: (payload: any) => void
) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!id) return;
    ensureConnected();

    const key = `${channel}:${id}`;
    const handler: MessageHandler = (msg) => handlerRef.current(msg.payload);
    addHandler(key, handler);

    // Subscribe on the server
    sendWsMessage({ type: "subscribe", channel, id });

    return () => {
      removeHandler(key, handler);
      sendWsMessage({ type: "unsubscribe", channel, id });
    };
  }, [channel, id]);
}

/** Listen to all gateway messages (global bus) */
export function useWsGlobal(onMessage: (msg: any) => void) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    ensureConnected();
    const handler: MessageHandler = (msg) => handlerRef.current(msg);
    addHandler("__global__", handler);
    return () => removeHandler("__global__", handler);
  }, []);
}

/** Initialize the WS connection (call once at the app root) */
export function useWsConnect() {
  useEffect(() => {
    connect();
    return () => {
      if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    };
  }, []);
}
