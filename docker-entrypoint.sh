#!/bin/sh
set -e
mkdir -p /app/sessions /app/status-media
chown -R node:node /app/sessions /app/status-media
exec su-exec node "$@"
