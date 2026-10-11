#!/usr/bin/env bash
set -euo pipefail
# Docker may be active before Qinglong finishes starting. systemd retries on failure.
deadline=$((SECONDS + 300))
while ((SECONDS < deadline)); do
    if "${NODE_PATH:?NODE_PATH is required}" "$(dirname -- "${BASH_SOURCE[0]}")/ql_token_admin.cjs" --resolve-container "${QL_CONTAINER:-qinglong}" "${QL_HIK_DAKA_PATH:-}"; then
        cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
        exec "${NODE_PATH:?NODE_PATH is required}" server.cjs
    fi
    sleep 5
done
echo '青龙等待 300 秒仍未就绪，稍后由 systemd 重试。' >&2
exit 1
