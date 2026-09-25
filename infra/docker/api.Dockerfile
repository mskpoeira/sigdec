FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --filter @sigdec/api... --frozen-lockfile

COPY apps/api apps/api
COPY db db

RUN pnpm --filter @sigdec/api build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000
ENV MIGRATIONS_DIR=/app/db/migrations

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
