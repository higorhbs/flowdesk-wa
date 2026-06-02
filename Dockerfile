FROM node:20-alpine AS builder
ARG NODE_OPTIONS=--max-old-space-size=256
ENV NODE_OPTIONS=${NODE_OPTIONS}
ENV CI=true
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
RUN pnpm --filter @flowdesk/shared build
RUN pnpm --filter @flowdesk/firebase build
RUN pnpm --filter @flowdesk/whatsapp-client build
RUN pnpm --filter @flowdesk/wa-api build

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

RUN apk add --no-cache su-exec \
  && mkdir -p /app/sessions /app/status-media /app/chat-media \
  && chown -R node:node /app/sessions /app/status-media /app/chat-media

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "apps/wa-api/dist/index.js"]
