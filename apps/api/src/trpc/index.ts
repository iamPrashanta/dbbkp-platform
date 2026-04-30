import { router } from "./trpc";

import { authRouter } from "./routers/auth.router";
import { backupRouter } from "./routers/backup.router";
import { infraRouter } from "./routers/infra.router";
import { pipelineRouter } from "./routers/pipeline.router";
import { sitesRouter } from "./routers/sites.router";

export const appRouter = router({
  auth: authRouter,
  backup: backupRouter,
  infra: infraRouter,
  pipeline: pipelineRouter,
  sites: sitesRouter,
});

export type AppRouter = typeof appRouter;