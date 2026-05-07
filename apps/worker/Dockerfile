FROM node:20-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json ./packages/db/
COPY packages/audit/package.json ./packages/audit/
COPY packages/security/package.json ./packages/security/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile --prod

COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/
COPY tsconfig.json ./

CMD ["node", "--loader", "ts-node/esm", "apps/worker/src/index.ts"]
