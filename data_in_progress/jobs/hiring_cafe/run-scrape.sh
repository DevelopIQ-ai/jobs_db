#!/usr/bin/env bash
# Relaunch the hiring.cafe SSR scrape if it isn't already running.
# Safe to call repeatedly (cron @reboot + periodic check).
# Uses xvfb-run so it doesn't depend on a desktop X server.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pgrep -f "tsx scrape-ssr.ts" >/dev/null && exit 0

cd "$DIR" || exit 1
mkdir -p output
nohup xvfb-run -a npx tsx scrape-ssr.ts 1453 30 >> output/scrape-ssr-full.log 2>&1 &
