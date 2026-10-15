#!/usr/bin/env bash
# Run only in an expendable Linux container; mock systemd/Docker, run real Node/HTTP.
# docker run --rm --network none -v "$PWD:/repo:ro" --entrypoint bash whyour/qinglong:latest /repo/token-admin/install.test.sh
set -euo pipefail
[[ "${TOKEN_ADMIN_INSTALL_TEST:-}" == 1 ]] || { echo '仅限一次性容器：设置 TOKEN_ADMIN_INSTALL_TEST=1'; exit 1; }
REPO=$(cd "$(dirname "$0")/.." && pwd)
export FIXTURE_REPO=$REPO
TEST_ROOT=$(mktemp -d)
export TEST_ROOT
mkdir -p "$TEST_ROOT/bin" /run/systemd/system /run/lock /etc/systemd/system
mkdir -p /ql/data/scripts/askd126_daka/qinglong
printf 'module.exports = { getAccount: async () => ({ accountNo: "fixture" }) };\n' > /ql/data/scripts/askd126_daka/qinglong/hik_daka.js
mkdir -p /ql/data/config /ql/shell/preload
printf 'module.exports = { getEnvs: async () => ({code:200,data:[]}), close() {} };\n' > /ql/shell/preload/client.js
export PATH="$TEST_ROOT/bin:$PATH"
cleanup() {
  local pid_file
  for pid_file in "$TEST_ROOT"/*.pid; do
    [[ ! -f "$pid_file" ]] || kill "$(cat "$pid_file")" 2>/dev/null || true
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT
cat > "$TEST_ROOT/bin/systemctl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
cmd=$1; shift
quiet=no
[[ "${1:-}" != --quiet ]] || { quiet=yes; shift; }
name=${1:-hik-daka-token-admin}; name=${name%.service}
file=$TEST_ROOT/$name.pid
stop() { if [[ -f "$file" ]]; then kill "$(cat "$file")" 2>/dev/null || true; rm -f "$file"; /bin/sleep 0.15; fi; }
active() { [[ -f "$file" ]] && kill -0 "$(cat "$file")" 2>/dev/null; }
start() {
  active && return 0
  if [[ "$name" != hik-daka-token-admin ]]; then /bin/sleep 300 9>&- & echo $! > "$file"; return; fi
  local dir
  dir=$(sed -n 's/^WorkingDirectory=//p' /etc/systemd/system/hik-daka-token-admin.service)
  (set -a; source /etc/hik-daka-token-admin.env; exec bash "$dir/start-linux.sh") 9>&- > "$TEST_ROOT/service.log" 2>&1 &
  echo $! > "$file"
}
case "$cmd" in
  enable) touch "$TEST_ROOT/$name.enabled" ;;
  disable) rm -f "$TEST_ROOT/$name.enabled" ;;
  is-enabled) if [[ -f "$TEST_ROOT/$name.enabled" ]]; then echo enabled; else echo disabled; exit 1; fi ;;
  is-active) if active; then [[ "$quiet" == yes ]] || echo active; else [[ "$quiet" == yes ]] || echo inactive; exit 3; fi ;;
  stop) stop ;;
  start) start ;;
  restart) stop; start ;;
  show) echo 'TOKEN_ADMIN_HOST=127.0.0.1 QL_CONTAINER=service-qinglong TOKEN_ADMIN_PORT=15715' ;;
  daemon-reload|cat|status) : ;;
  *) echo "unexpected systemctl $cmd" >&2; exit 1 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/docker.calls"
case "$1" in
  info|start) : ;;
  cp) cp "$2" "${3#*:}" ;;
  inspect)
    case "$*" in
      *NetworkSettings.Networks*) echo 127.0.0.1 ;;
      *State.Running*) echo true ;;
      *RestartPolicy*) cat "$TEST_ROOT/restart-policy" ;;
    esac ;;
  update) echo "$3" > "$TEST_ROOT/restart-policy" ;;
  exec)
    shift
    while [[ "$1" == -* ]]; do
      case "$1" in -i) shift ;; -e) export "$2"; shift 2 ;; *) exit 1 ;; esac
    done
    shift # container name
    if [[ "$1" == chmod ]]; then exec /bin/chmod "${@:2}"; fi
    [[ "$1" == node ]] || exit 1
    shift
    exec /usr/bin/node "$@" ;;
  *) exit 1 ;;
esac
MOCK
cat > "$TEST_ROOT/bin/journalctl" <<'MOCK'
#!/bin/sh
cat "$TEST_ROOT/service.log"
MOCK
cat > "$TEST_ROOT/bin/sleep" <<'MOCK'
#!/bin/sh
exec /bin/sleep 0.1
MOCK
chmod +x "$TEST_ROOT/bin/"*
mkdir -p "$TEST_ROOT/download/node-v24.0.0-linux-x64/bin"
printf '#!/bin/sh\nexec /usr/bin/node "$@"\n' > "$TEST_ROOT/download/node-v24.0.0-linux-x64/bin/node"
chmod +x "$TEST_ROOT/download/node-v24.0.0-linux-x64/bin/node"
(cd "$TEST_ROOT/download"; tar -czf node-v24.0.0-linux-x64.tar.gz node-v24.0.0-linux-x64; sha256sum node-v24.0.0-linux-x64.tar.gz > SHASUMS256.txt)
cat > "$TEST_ROOT/bin/node" <<'MOCK'
#!/bin/sh
exit 1
MOCK
cat > "$TEST_ROOT/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -eu
for arg in "$@"; do
  case "$arg" in
    https://nodejs.org/dist/latest-v24.x/*)
      name=${arg##*/}
      dest=${@: -1}
      cp "$TEST_ROOT/download/$name" "$dest"
      if [[ "$name" == *.tar.gz && -f "$TEST_ROOT/bad-checksum" ]]; then echo corrupt >> "$dest"; fi
      exit 0 ;;
  esac
done
exec /usr/bin/curl "$@"
MOCK
cat > "$TEST_ROOT/bin/git" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$TEST_ROOT/git.calls"
[[ ! -f "$TEST_ROOT/git-fail" ]] || exit 1
dest=${@: -1}
mkdir -p "$dest"
cp -r "$FIXTURE_REPO/token-admin" "$dest/"
MOCK
chmod +x "$TEST_ROOT/bin/"*
echo no > "$TEST_ROOT/restart-policy"
SCRIPT=$REPO/token-admin/install.sh
assert() { "$@" || { echo "FAIL: $*" >&2; exit 1; }; }
assert sh "$SCRIPT" --help
assert bash -n "$SCRIPT"
assert bash -n "$REPO/token-admin/start-linux.sh"
if bash "$SCRIPT" install --yes --unknown > "$TEST_ROOT/invalid.log" 2>&1; then exit 1; fi
echo 'PASS: help, sh bootstrap, syntax, invalid option'

# Bootstrap must reject a corrupt runtime before activating any service.
touch "$TEST_ROOT/bad-checksum"
if bash "$SCRIPT" install --yes --source "$REPO" --dir "$TEST_ROOT/app" > "$TEST_ROOT/checksum.log" 2>&1; then exit 1; fi
assert test ! -f /etc/hik-daka-token-admin.env
rm "$TEST_ROOT/bad-checksum"
echo 'PASS: corrupted Node download rejected before service changes'

# Fresh installation runs the real server. No live Qinglong or host systemd involved.
bash "$SCRIPT" install --yes --source "$REPO" --dir "$TEST_ROOT/app" --port 15710 --container legacy-ql
assert grep -q '^TOKEN_ADMIN_PORT=15710$' /etc/hik-daka-token-admin.env
assert test -f "$TEST_ROOT/hik-daka-token-admin.enabled"
assert test "$(cat "$TEST_ROOT/restart-policy")" = unless-stopped
assert test ! -f /ql/data/scripts/hik_daka.js
assert grep -q 'askd126_daka/qinglong/hik_daka.js' "$TEST_ROOT/service.log"
assert curl --noproxy '*' -fsS http://127.0.0.1:15710/api/status
first=$(readlink "$TEST_ROOT/app/current")
echo 'PASS: fresh install, missing Node bootstrap, autostart, real HTTP, Docker policy'
rm "$TEST_ROOT/bin/node"

# Multiple subscriptions require an explicit persisted choice; no accidental version selection.
mkdir -p /ql/data/scripts/second-repo/qinglong
cp /ql/data/scripts/askd126_daka/qinglong/hik_daka.js /ql/data/scripts/second-repo/qinglong/hik_daka.js
if bash "$SCRIPT" update --yes --source "$REPO" > "$TEST_ROOT/ambiguous.log" 2>&1; then exit 1; fi
assert grep -q '找到多份' "$TEST_ROOT/ambiguous.log"
assert curl --noproxy '*' -fsS http://127.0.0.1:15710/api/status
bash "$SCRIPT" update --yes --source "$REPO" --core-path /ql/data/scripts/askd126_daka/qinglong/hik_daka.js
assert grep -q '^QL_HIK_DAKA_PATH=/ql/data/scripts/askd126_daka/qinglong/hik_daka.js$' /etc/hik-daka-token-admin.env
rm /ql/data/scripts/second-repo/qinglong/hik_daka.js
echo 'PASS: nested core loaded by real helper; multiple cores rejected or explicitly selected'

# Persistent configuration and old release survive updates, with no npm install.
cp -r "$REPO/token-admin" "$TEST_ROOT/source"
echo '/* updated */' >> "$TEST_ROOT/source/public/styles.css"
bash "$SCRIPT" update --yes --source "$TEST_ROOT/source" --no-autostart --no-container-autostart
assert grep -q '^QL_CONTAINER=legacy-ql$' /etc/hik-daka-token-admin.env
assert grep -q updated "$TEST_ROOT/app/current/public/styles.css"
assert test -d "$first"
assert test ! -f "$TEST_ROOT/hik-daka-token-admin.enabled"
second=$(readlink "$TEST_ROOT/app/current")
echo 'PASS: update retains configuration and old code; autostart can be disabled'

# Updates without --source use the saved/selectable repository; download failure leaves the old server up.
bash "$SCRIPT" update --yes --repo https://gitee.com/askd126/daka.git --core-path auto
assert grep -q 'https://gitee.com/askd126/daka.git' "$TEST_ROOT/git.calls"
assert grep -q '^REPO=https://gitee.com/askd126/daka.git$' /etc/hik-daka-token-admin.env
assert grep -q '^QL_HIK_DAKA_PATH=$' /etc/hik-daka-token-admin.env
second=$(readlink "$TEST_ROOT/app/current")
touch "$TEST_ROOT/git-fail"
if bash "$SCRIPT" update --yes > "$TEST_ROOT/download-failure.log" 2>&1; then exit 1; fi
assert test "$(readlink "$TEST_ROOT/app/current")" = "$second"
assert curl --noproxy '*' -fsS http://127.0.0.1:15710/ -o /dev/null
rm "$TEST_ROOT/git-fail"
echo 'PASS: remote update source preserved; download failure leaves running version untouched'

# Candidate passes syntax but dies at runtime: restore both code and changed config.
cp "$TEST_ROOT/source/server.cjs" "$TEST_ROOT/original-server.cjs"
printf 'process.exit(1);\n' > "$TEST_ROOT/source/server.cjs"
echo on-failure:3 > "$TEST_ROOT/restart-policy"
systemctl enable old-token-admin
systemctl start old-token-admin
if bash "$SCRIPT" update --yes --source "$TEST_ROOT/source" --port 15711 --autostart --container-autostart --legacy-service old-token-admin > "$TEST_ROOT/failure.log" 2>&1; then
  echo 'FAIL: broken version accepted'; exit 1
fi
assert test "$(readlink "$TEST_ROOT/app/current")" = "$second"
assert grep -q '^TOKEN_ADMIN_PORT=15710$' /etc/hik-daka-token-admin.env
assert test ! -f "$TEST_ROOT/hik-daka-token-admin.enabled"
assert test "$(cat "$TEST_ROOT/restart-policy")" = on-failure:3
assert test -f "$TEST_ROOT/old-token-admin.enabled"
assert systemctl is-active --quiet old-token-admin
/bin/sleep 0.3
assert curl --noproxy '*' -fsS http://127.0.0.1:15710/ -o /dev/null
echo 'PASS: failed update rolls back code, config and running service'

# Upgrade legacy npm/systemd installs by importing only recognized env values.
cp "$TEST_ROOT/original-server.cjs" "$TEST_ROOT/source/server.cjs"
mkdir -p "$TEST_ROOT/legacy/token-admin"
touch "$TEST_ROOT/legacy/token-admin/server.cjs" "$TEST_ROOT/legacy/keep-me"
cat > "$TEST_ROOT/legacy/token-admin/.env" <<'ENV'
TOKEN_ADMIN_HOST="127.0.0.1"
TOKEN_ADMIN_PORT=15712
QL_CONTAINER=old-qinglong
IGNORED=$(touch /tmp/token-admin-must-not-execute)
ENV
systemctl enable old-token-admin
systemctl start old-token-admin
bash "$SCRIPT" update --yes --source "$TEST_ROOT/source" --legacy-dir "$TEST_ROOT/legacy" --legacy-service old-token-admin --port 15713
assert grep -q '^TOKEN_ADMIN_HOST=127.0.0.1$' /etc/hik-daka-token-admin.env
assert grep -q '^TOKEN_ADMIN_PORT=15713$' /etc/hik-daka-token-admin.env
assert grep -q '^QL_CONTAINER=old-qinglong$' /etc/hik-daka-token-admin.env
assert test -f "$TEST_ROOT/legacy/keep-me"
assert test ! -e /tmp/token-admin-must-not-execute
assert test ! -f "$TEST_ROOT/old-token-admin.pid"
assert test ! -f "$TEST_ROOT/old-token-admin.enabled"
echo 'PASS: legacy migration preserves original directory, imports safe config, retires old service'

systemctl enable old-token-admin
systemctl start old-token-admin
bash "$SCRIPT" update --yes --source "$TEST_ROOT/source" --legacy-service old-token-admin
assert grep -q '^TOKEN_ADMIN_PORT=15715$' /etc/hik-daka-token-admin.env
assert grep -q '^QL_CONTAINER=service-qinglong$' /etc/hik-daka-token-admin.env
echo 'PASS: legacy systemd inline Environment settings imported'

# A duplicate manual process must be handled by its owner, never killed by the installer.
node -e 'require("http").createServer((q,s)=>s.end("other")).listen(15714,"127.0.0.1")' &
other=$!; echo "$other" > "$TEST_ROOT/other.pid"
/bin/sleep 0.2
if bash "$SCRIPT" update --yes --source "$TEST_ROOT/source" --port 15714 > "$TEST_ROOT/conflict.log" 2>&1; then exit 1; fi
assert kill -0 "$other"
assert grep -q '^TOKEN_ADMIN_PORT=15715$' /etc/hik-daka-token-admin.env
echo 'PASS: occupied port rejected; unrelated process preserved'
echo 'ALL INSTALLER TESTS PASSED'
