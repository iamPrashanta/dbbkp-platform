"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import React, { useState } from "react";
import { trpc } from "../utils/trpc";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return ""; // browser should use relative path
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`; // SSR on vercel
  return `http://localhost:4000`; // dev SSR
};

const apiUrl = getBaseUrl();

export default function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${apiUrl}/trpc`,
          headers() {
            if (typeof window !== "undefined") {
              const token = localStorage.getItem("token");
              return {
                authorization: token ? `Bearer ${token}` : undefined,
              };
            }
            return {};
          },
        }),
      ],
    } as any)
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
