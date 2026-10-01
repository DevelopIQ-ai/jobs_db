#!/usr/bin/env bash
# Relaunch the hiring.cafe SSR scrape if it isn't already running.
# Safe to call repeatedly (cron @reboot + periodic check) — pgrep plus the
# scraper's own output/scrape.lock both guard against duplicate runs.
# Uses xvfb-run so it doesn't depend on a desktop X server.
# A completed sweep is promoted to leads.jsonl, archived, and the next launch
# starts a fresh sweep.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pgrep -f "tsx scraper.ts" >/dev/null && exit 0

cd "$DIR" || exit 1
mkdir -p output
nohup xvfb-run -a npx tsx scraper.ts 1453 30 >> output/scrape.log 2>&1 &
