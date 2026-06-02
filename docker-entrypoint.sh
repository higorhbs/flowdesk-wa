#!/bin/sh
set -e
mkdir -p /app/sessions /app/status-media /app/chat-media
chown -R node:node /app/sessions /app/status-media /app/chat-media
exec su-exec node "$@"
