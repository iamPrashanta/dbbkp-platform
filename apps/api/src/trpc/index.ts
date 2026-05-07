import { router } from "./trpc";

import { authRouter } from "./routers/auth.router";
import { backupRouter } from "./routers/backup.router";
import { infraRouter } from "./routers/infra.router";
import { sitesRouter } from "./routers/sites.router";
import { databaseRouter } from "./routers/database.router";
import { cronRouter } from "./routers/cron.router";
import { filesRouter } from "./routers/files.router";
import { auditRouter, secretsRouter } from "./routers/audit.router";
import { nodesRouter } from "./routers/nodes.router";
import { securityRouter } from "./routers/security.router";
import { pipelineRouter } from "./routers/pipelines.router";

export const appRouter = router({
  auth: authRouter,
  backup: backupRouter,
  infra: infraRouter,
  pipeline: pipelineRouter,
  sites: sitesRouter,
  database: databaseRouter,
  cron: cronRouter,
  files: filesRouter,
  audit: auditRouter,
  secrets: secretsRouter,
  nodes: nodesRouter,
  security: securityRouter,
});

export type AppRouter = typeof appRouter;