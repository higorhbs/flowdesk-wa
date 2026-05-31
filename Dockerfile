FROM node:20-alpine AS builder
ARG NODE_OPTIONS=--max-old-space-size=384
ENV NODE_OPTIONS=${NODE_OPTIONS}
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/wa-api/package.json apps/wa-api/
COPY packages/firebase/package.json packages/firebase/
COPY packages/shared/package.json packages/shared/
COPY packages/whatsapp-client/package.json packages/whatsapp-client/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/wa-api apps/wa-api
COPY packages/firebase packages/firebase
COPY packages/shared packages/shared
COPY packages/whatsapp-client packages/whatsapp-client
RUN pnpm --filter @flowdesk/firebase build \
  && pnpm --filter @flowdesk/shared build \
  && pnpm --filter @flowdesk/whatsapp-client build \
  && pnpm --filter @flowdesk/wa-api build

FROM node:20-alpine AS runner
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/wa-api/package.json apps/wa-api/
COPY packages/firebase/package.json packages/firebase/
COPY packages/shared/package.json packages/shared/
COPY packages/whatsapp-client/package.json packages/whatsapp-client/

RUN pnpm install --frozen-lockfile --prod --ignore-scripts && pnpm store prune

COPY --from=builder /app/apps/wa-api/dist apps/wa-api/dist
COPY --from=builder /app/packages/firebase/dist packages/firebase/dist
COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/packages/whatsapp-client/dist packages/whatsapp-client/dist

RUN mkdir -p /app/sessions && chown node:node /app/sessions
USER node

EXPOSE 3001
CMD ["node", "apps/wa-api/dist/index.js"]
