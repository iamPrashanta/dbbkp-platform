import { router } from "../trpc";
import { authRouter } from "./routers/auth.router";
import { backupRouter } from "./routers/backup.router";
import { infraRouter } from "./routers/infra.router";
import { pipelineRouter } from "./routers/pipeline.router";

export const appRouter = router({
  auth: authRouter,
  backup: backupRouter,
  infra: infraRouter,
  pipeline: pipelineRouter,
});

export type AppRouter = typeof appRouter;
