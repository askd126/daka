#!/usr/bin/env bash
set -euo pipefail
# Docker may be active before Qinglong finishes starting. systemd retries on failure.
for ((attempt=0; attempt<60; attempt++)); do
    if docker exec "${QL_CONTAINER:-qinglong}" test -f /ql/data/scripts/hik_daka.js 2>/dev/null; then
        cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
        exec "${NODE_PATH:?NODE_PATH is required}" server.cjs
    fi
    sleep 5
done
echo '青龙等待 300 秒仍未就绪，稍后由 systemd 重试。' >&2
exit 1
