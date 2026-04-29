import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@dbbkp/api/src/trpc/index";

export const trpc = createTRPCReact<AppRouter>();
