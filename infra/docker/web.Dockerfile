FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --filter @sigdec/web... --frozen-lockfile

COPY apps/web apps/web

ARG NEXT_PUBLIC_SIGDEC_API_URL
ENV NEXT_PUBLIC_SIGDEC_API_URL=$NEXT_PUBLIC_SIGDEC_API_URL
ENV NODE_ENV=production

RUN pnpm --filter @sigdec/web build

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "--filter", "@sigdec/web", "start"]
