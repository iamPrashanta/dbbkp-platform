import crypto from "node:crypto";

/**
 * Distributed Traceability Utilities
 * 
 * Provides standard IDs for correlation and tracing across 
 * microservices, workers, and agents.
 */

export interface TraceContext {
  correlationId: string;
  traceId: string;
  spanId?: string;
}

export const TraceUtils = {
  /**
   * Create a fresh trace context for a new operation.
   */
  createContext(): TraceContext {
    return {
      correlationId: crypto.randomUUID(),
      traceId: crypto.randomUUID(),
    };
  },

  /**
   * Derive a new context from an existing one (e.g. for a sub-task).
   */
  childContext(parent: TraceContext): TraceContext {
    return {
      ...parent,
      spanId: crypto.randomUUID(),
    };
  },

  /**
   * Middleware/Helper to extract or inject trace headers.
   */
  toHeaders(ctx: TraceContext): Record<string, string> {
    return {
      "x-correlation-id": ctx.correlationId,
      "x-trace-id": ctx.traceId,
      ...(ctx.spanId ? { "x-span-id": ctx.spanId } : {}),
    };
  }
};
