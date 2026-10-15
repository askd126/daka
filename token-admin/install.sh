#!/bin/sh
# Accept both `sh install.sh` and `bash install.sh`.
[ -n "${BASH_VERSION:-}" ] || exec bash "$0" "$@"
# shellcheck shell=bash
set -Eeuo pipefail
umask 022

SERVICE=hik-daka-token-admin
CONFIG=/etc/hik-daka-token-admin.env
UNIT=/etc/systemd/system/$SERVICE.service
INSTALL_DIR=/opt/hik-daka-token-admin
REPO=https://github.com/askd126/daka.git
BRANCH=main
TOKEN_ADMIN_HOST=0.0.0.0
TOKEN_ADMIN_PORT=5710
QL_CONTAINER=qinglong
QL_HIK_DAKA_PATH=
AUTOSTART=yes
CONTAINER_AUTOSTART=yes
NODE_PATH=
SOURCE_DIR=
LEGACY_DIR=
LEGACY_ENV=
LEGACY_SERVICE=
YES=no
ACTION=install
TMP=
TRANSACTION=no
declare -A overrides=()

log() { printf '\n[Token Admin] %s\n' "$*"; }
die() { printf '\n错误：%s\n' "$*" >&2; exit 1; }
usage() {
    cat <<'HELP'
用法：sudo bash install.sh [install|update|status|start|stop|restart|logs] [选项]
默认交互安装；--yes 使用默认值或保留已有配置，全程不询问。

  --yes, -y                  全自动（install/update）
  --dir /opt/目录             独立安装目录（更新沿用原目录）
  --repo https://.../daka.git 更新源，也可使用 Gitee
  --branch main              分支
  --host 0.0.0.0             监听地址
  --port 5710                端口
  --container qinglong       已有青龙容器名称
  --core-path /容器内路径.js  多份核心脚本时指定；传 auto 恢复自动查找
  --autostart / --no-autostart 前端开机自启开关（不影响立即启动）
  --container-autostart      Docker 开机启动、青龙 restart=unless-stopped（默认）
  --no-container-autostart   保留 Docker/青龙原有启动策略
  --node /绝对路径/node       使用指定的 Node.js >=18
  --source /路径/daka         使用本地代码，跳过 Git 下载（可为 token-admin 目录）
  --legacy-dir /路径/daka     保留旧目录；读取其中 .env 的前端设置
  --legacy-env /路径/文件     导入旧 EnvironmentFile 的前端设置
  --legacy-service 服务名     导入旧服务内联环境设置并接管，成功后禁用；失败恢复
  --help, -h                 查看帮助

缺少 Node 时自动下载 Node.js 24 LTS 独立运行时并校验 SHA256。
需已有 Docker、青龙容器及本项目订阅。不会安装/重建青龙或更改账号变量。
HELP
}

# Parse as data, never source an old .env or execute its contents as root.
read_config() {
    local file=$1 mode=$2 key value
    [[ -f "$file" ]] || return 0
    while IFS= read -r line || [[ -n "$line" ]]; do
        line=${line%$'\r'}
        [[ "$line" =~ ^(export[[:space:]]+)?([A-Z_]+)=(.*)$ ]] || continue
        key=${BASH_REMATCH[2]}; value=${BASH_REMATCH[3]}
        if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then value=${value:1:-1}; fi
        case "$key" in
            TOKEN_ADMIN_HOST|TOKEN_ADMIN_PORT|QL_CONTAINER|QL_HIK_DAKA_PATH) printf -v "$key" '%s' "$value" ;;
            INSTALL_DIR|REPO|BRANCH|NODE_PATH|AUTOSTART|CONTAINER_AUTOSTART)
                if [[ "$mode" == managed ]]; then printf -v "$key" '%s' "$value"; fi ;;
        esac
    done < "$file"
}

# Help works without root/systemd. All other commands manage a system service.
for arg in "$@"; do [[ "$arg" != --help && "$arg" != -h ]] || { usage; exit 0; }; done
[[ $(uname -s) == Linux ]] || die '此脚本用于 Linux + systemd；Windows 请使用 PowerShell 安装脚本。'
[[ $EUID == 0 ]] || die '请使用 sudo bash install.sh ... 运行。'
command -v systemctl >/dev/null && [[ -d /run/systemd/system ]] || die '需要正在运行的 systemd（Ubuntu/Debian 主机）。'
command -v flock >/dev/null || die '需要 flock（Ubuntu 默认提供；可安装 util-linux）。'
exec 9>/run/lock/hik-daka-token-admin.lock
flock -n 9 || die '另一个安装/管理操作正在进行。'
read_config "$CONFIG" managed
OLD_INSTALL_DIR=$INSTALL_DIR
while (($#)); do
    case "$1" in
        install|update|status|start|stop|restart|logs) ACTION=$1; shift ;;
        --yes|-y) YES=yes; shift ;;
        --autostart) overrides[AUTOSTART]=yes; shift ;;
        --no-autostart) overrides[AUTOSTART]=no; shift ;;
        --container-autostart) overrides[CONTAINER_AUTOSTART]=yes; shift ;;
        --no-container-autostart) overrides[CONTAINER_AUTOSTART]=no; shift ;;
        --dir|--repo|--branch|--host|--port|--container|--core-path|--node|--source|--legacy-dir|--legacy-env|--legacy-service)
            (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || die "$1 缺少参数"
            case "$1" in
                --dir) overrides[INSTALL_DIR]=$2 ;; --repo) overrides[REPO]=$2 ;;
                --branch) overrides[BRANCH]=$2 ;; --host) overrides[TOKEN_ADMIN_HOST]=$2 ;;
                --port) overrides[TOKEN_ADMIN_PORT]=$2 ;; --container) overrides[QL_CONTAINER]=$2 ;;
                --node) overrides[NODE_PATH]=$2 ;; --source) SOURCE_DIR=$2 ;;
                --core-path) overrides[QL_HIK_DAKA_PATH]=$2 ;;
                --legacy-dir) LEGACY_DIR=$2 ;; --legacy-env) LEGACY_ENV=$2 ;;
                --legacy-service) LEGACY_SERVICE=${2%.service} ;;
            esac
            shift 2 ;;
        *) die "未知参数：$1（用 --help 查看）" ;;
    esac
done
case "$ACTION" in
    status) systemctl status "$SERVICE" --no-pager; exit $? ;;
    start|stop|restart) systemctl "$ACTION" "$SERVICE"; exit $? ;;
    logs) journalctl -u "$SERVICE" -n 100 --no-pager; exit $? ;;
esac

if [[ -n "$LEGACY_SERVICE" ]]; then
    [[ "$LEGACY_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || die '旧服务名格式不合法'
    systemctl cat "$LEGACY_SERVICE" >/dev/null || die '指定的旧服务不存在'
    legacy_environment=$(systemctl show "$LEGACY_SERVICE" --property=Environment --value)
    read -r -a legacy_entries <<< "$legacy_environment"
    for entry in "${legacy_entries[@]}"; do
        entry=${entry#\"}; entry=${entry%\"}
        if [[ "$entry" =~ ^(TOKEN_ADMIN_HOST|TOKEN_ADMIN_PORT|QL_CONTAINER|QL_HIK_DAKA_PATH)=([a-zA-Z0-9_./:-]+)$ ]]; then
            printf -v "${BASH_REMATCH[1]}" '%s' "${BASH_REMATCH[2]}"
        fi
    done
fi
if [[ -n "$LEGACY_DIR" ]]; then
    [[ -d "$LEGACY_DIR/token-admin" ]] && LEGACY_DIR=$LEGACY_DIR/token-admin
    [[ -f "$LEGACY_DIR/server.cjs" ]] || die '旧目录中未找到 server.cjs'
    read_config "$LEGACY_DIR/.env" legacy
fi
if [[ -n "$LEGACY_ENV" ]]; then
    [[ -f "$LEGACY_ENV" ]] || die '指定的旧配置文件不存在'
    read_config "$LEGACY_ENV" legacy
fi
for key in "${!overrides[@]}"; do printf -v "$key" '%s' "${overrides[$key]}"; done

ask() {
    local variable=$1 label=$2 answer
    read -r -p "$label [${!variable}]: " answer
    [[ -z "$answer" ]] || printf -v "$variable" '%s' "$answer"
    return 0
}
if [[ "$YES" == no ]]; then
    [[ -t 0 ]] || die '无交互终端，请添加 --yes 或在终端中运行。'
    ask INSTALL_DIR '安装目录'
    ask REPO '更新仓库 URL'
    ask BRANCH '更新分支'
    ask TOKEN_ADMIN_HOST '监听地址'
    ask TOKEN_ADMIN_PORT '页面端口'
    ask QL_CONTAINER '青龙容器名'
    ask QL_HIK_DAKA_PATH '核心脚本容器路径（留空/auto 自动查找）'
    ask AUTOSTART '前端开机自启 yes/no'
    ask CONTAINER_AUTOSTART '设置 Docker/青龙开机启动 yes/no'
fi
[[ "$QL_HIK_DAKA_PATH" != auto ]] || QL_HIK_DAKA_PATH=

[[ "$INSTALL_DIR" =~ ^/[a-zA-Z0-9_./-]+$ && "$INSTALL_DIR" != *'/../'* && "$INSTALL_DIR" != */.. ]] || die '安装路径必须为无空格的绝对路径，不能含 ..'
INSTALL_DIR=$(realpath -m "$INSTALL_DIR")
case "$INSTALL_DIR" in /|/opt|/usr|/etc|/var|/home|/root|/tmp) die '请选择独立子目录，不能使用系统目录本身' ;; esac
[[ ! -f "$CONFIG" || "$INSTALL_DIR" == "$OLD_INSTALL_DIR" ]] || die '已有安装不能直接更换 --dir；请沿用原目录。'
if [[ ! "$TOKEN_ADMIN_PORT" =~ ^[0-9]{1,5}$ ]]; then die '端口须为 1–65535'; fi
((10#$TOKEN_ADMIN_PORT >= 1 && 10#$TOKEN_ADMIN_PORT <= 65535)) || die '端口须为 1–65535'
TOKEN_ADMIN_PORT=$((10#$TOKEN_ADMIN_PORT))
[[ "$TOKEN_ADMIN_HOST" =~ ^[a-zA-Z0-9.:_-]+$ ]] || die '监听地址格式不合法'
[[ "$QL_CONTAINER" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || die '容器名格式不合法'
[[ -z "$QL_HIK_DAKA_PATH" || "$QL_HIK_DAKA_PATH" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die '核心脚本需要无空格的容器内绝对路径'
[[ "$BRANCH" =~ ^[a-zA-Z0-9][a-zA-Z0-9_./-]*$ ]] || die '分支格式不合法'
[[ "$REPO" =~ ^https://[a-zA-Z0-9./_:@%-]+$ ]] || die '仓库必须是 HTTPS URL'
[[ "$AUTOSTART" =~ ^(yes|no)$ && "$CONTAINER_AUTOSTART" =~ ^(yes|no)$ ]] || die '启动开关须为 yes 或 no'
[[ -z "$LEGACY_SERVICE" || "$LEGACY_SERVICE" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$ ]] || die '旧服务名格式不合法'
if [[ -e "$INSTALL_DIR" && ! -f "$INSTALL_DIR/.token-admin-managed" ]]; then
    [[ -d "$INSTALL_DIR" && -z $(ls -A "$INSTALL_DIR") ]] || die '目标目录已有非托管文件；请选择新 --dir，并用 --legacy-dir 指定旧目录。'
fi
if [[ -f "$UNIT" && ! -f "$CONFIG" && "$LEGACY_SERVICE" != "$SERVICE" ]]; then
    die "发现同名旧服务，请添加 --legacy-service $SERVICE 并用 --legacy-env 导入配置。"
fi
command -v docker >/dev/null || die '请先安装 Docker 并部署青龙；此脚本不重建已有青龙。'

missing=no
for tool in curl git tar sha256sum; do command -v "$tool" >/dev/null || missing=yes; done
if [[ "$missing" == yes ]]; then
    command -v apt-get >/dev/null || die '请先安装 curl git tar coreutils'
    log '安装下载与校验工具'
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl git tar ca-certificates coreutils
fi
log "执行 $ACTION：$INSTALL_DIR；$TOKEN_ADMIN_HOST:$TOKEN_ADMIN_PORT；容器 $QL_CONTAINER"
TMP=$(mktemp -d)
cleanup() {
    local code=$?
    trap - EXIT
    if [[ "$TRANSACTION" == yes ]]; then
        log '安装未完成，恢复旧代码、配置和服务状态'
        set +e
        systemctl stop "$SERVICE"
        if [[ -n "$OLD_CURRENT" ]]; then
            ln -s "$OLD_CURRENT" "$INSTALL_DIR/.rollback-link"
            mv -Tf "$INSTALL_DIR/.rollback-link" "$INSTALL_DIR/current"
        else
            rm -f "$INSTALL_DIR/current"
        fi
        if [[ -f "$BACKUP/config.env" ]]; then cp -p "$BACKUP/config.env" "$CONFIG"; else rm -f "$CONFIG"; fi
        if [[ -f "$BACKUP/service.unit" ]]; then cp -p "$BACKUP/service.unit" "$UNIT"; else rm -f "$UNIT"; fi
        systemctl daemon-reload
        if [[ "$OLD_ENABLED" == enabled ]]; then systemctl enable "$SERVICE"; else systemctl disable "$SERVICE"; fi
        [[ "$OLD_ACTIVE" != active ]] || systemctl start "$SERVICE"
        if [[ -n "$LEGACY_SERVICE" && "$LEGACY_SERVICE" != "$SERVICE" ]]; then
            [[ "$LEGACY_ENABLED" != enabled ]] || systemctl enable "$LEGACY_SERVICE"
            [[ "$LEGACY_ACTIVE" != active ]] || systemctl start "$LEGACY_SERVICE"
        fi
        [[ -z "${OLD_RESTART:-}" ]] || docker update --restart "$OLD_RESTART" "$QL_CONTAINER" >/dev/null
        rm -f "$INSTALL_DIR/.next-link" "$INSTALL_DIR/.rollback-link"
    fi
    [[ -z "$TMP" ]] || rm -rf -- "$TMP"
    exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -n "$SOURCE_DIR" ]]; then
    [[ -d "$SOURCE_DIR/token-admin" ]] && SOURCE_DIR=$SOURCE_DIR/token-admin
    SOURCE_DIR=$(realpath "$SOURCE_DIR")
else
    log '下载最新前端代码（不会修改旧仓库工作区）'
    git clone --depth 1 --branch "$BRANCH" -- "$REPO" "$TMP/repo"
    SOURCE_DIR=$TMP/repo/token-admin
fi
for file in server.cjs auto-login.cjs ql_token_admin.cjs package.json public/index.html public/app.js public/auto-login.js public/styles.css vendor/crypto-js.cjs vendor/crypto-js.LICENSE install.sh start-linux.sh; do
    [[ -f "$SOURCE_DIR/$file" ]] || die "代码不完整，缺少 $file；旧版请通过 --legacy-dir 迁移，再从最新仓库下载。"
done
mkdir -p "$INSTALL_DIR/releases" "$INSTALL_DIR/backups"
touch "$INSTALL_DIR/.token-admin-managed"

valid_node() { [[ -x "$1" ]] && "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; }
if [[ -n "$NODE_PATH" ]]; then
    [[ "$NODE_PATH" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die '指定的 Node 需要无空格的绝对路径'
    valid_node "$NODE_PATH" || die '指定的 Node 无效，需要 Node.js >=18'
else
    candidate=$(command -v node || true)
    if [[ -n "$candidate" ]] && valid_node "$candidate"; then
        NODE_PATH=$(realpath "$candidate")
    else
        case $(uname -m) in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die '自动 Node 安装支持 x86_64/arm64，请用 --node 指定运行时' ;; esac
        base=https://nodejs.org/dist/latest-v24.x
        log '下载 Node.js 24 LTS 独立运行时'
        curl -fSL --retry 3 --connect-timeout 15 "$base/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
        archive=$(awk -v suffix="-linux-$arch.tar.gz" 'substr($2,length($2)-length(suffix)+1)==suffix {print $2; exit}' "$TMP/SHASUMS256.txt")
        [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.gz$ ]] || die 'Node 官方校验列表无可用包'
        curl -fSL --retry 3 --connect-timeout 15 "$base/$archive" -o "$TMP/$archive"
        (cd "$TMP"; awk -v name="$archive" '$2==name' SHASUMS256.txt | sha256sum -c -)
        mkdir -p "$INSTALL_DIR/runtime"
        tar -xzf "$TMP/$archive" -C "$INSTALL_DIR/runtime" --no-same-owner
        NODE_PATH=$INSTALL_DIR/runtime/${archive%.tar.gz}/bin/node
        valid_node "$NODE_PATH" || die 'Node 无法运行；请检查 Linux glibc 兼容性，或用 --node 指定已有运行时'
    fi
fi
# Avoid unit-file quoting/interpolation ambiguities, including nvm paths with spaces.
[[ "$NODE_PATH" =~ ^/[a-zA-Z0-9_./-]+$ ]] || die 'Node 路径不能含空格或特殊字符'
for file in server.cjs ql_token_admin.cjs public/app.js; do "$NODE_PATH" --check "$SOURCE_DIR/$file"; done
bash -n "$SOURCE_DIR/start-linux.sh"

if [[ "$CONTAINER_AUTOSTART" == yes ]]; then systemctl enable --now docker.service; fi
docker info >/dev/null 2>&1 || die 'Docker 未就绪，无法连接；请先启动 Docker'
docker inspect "$QL_CONTAINER" >/dev/null 2>&1 || die "青龙容器不存在：$QL_CONTAINER"
if [[ $(docker inspect --format '{{.State.Running}}' "$QL_CONTAINER") != true ]]; then
    [[ "$CONTAINER_AUTOSTART" == yes ]] || die '青龙容器未启动'
    docker start "$QL_CONTAINER" >/dev/null
fi
"$NODE_PATH" "$SOURCE_DIR/ql_token_admin.cjs" --resolve-container "$QL_CONTAINER" "$QL_HIK_DAKA_PATH" || die '青龙核心脚本检查失败，参见上方具体原因'

version=$(date -u +%Y%m%dT%H%M%SZ)-$$
RELEASE=$INSTALL_DIR/releases/$version
BACKUP=$INSTALL_DIR/backups/$version
mkdir -p "$RELEASE/public" "$BACKUP"
for file in server.cjs auto-login.cjs ql_token_admin.cjs package.json install.sh start-linux.sh README.md; do
    [[ ! -f "$SOURCE_DIR/$file" ]] || cp "$SOURCE_DIR/$file" "$RELEASE/$file"
done
cp "$SOURCE_DIR/public/"* "$RELEASE/public/"
mkdir -p "$RELEASE/vendor"
cp "$SOURCE_DIR/vendor/"* "$RELEASE/vendor/"
chmod 755 "$RELEASE/install.sh" "$RELEASE/start-linux.sh"
OLD_CURRENT=$(readlink "$INSTALL_DIR/current" || true)
OLD_ACTIVE=$(systemctl is-active "$SERVICE" || true)
OLD_ENABLED=$(systemctl is-enabled "$SERVICE" 2>/dev/null || true)
LEGACY_ACTIVE=inactive; LEGACY_ENABLED=disabled
[[ ! -f "$CONFIG" ]] || cp -p "$CONFIG" "$BACKUP/config.env"
[[ ! -f "$UNIT" ]] || cp -p "$UNIT" "$BACKUP/service.unit"
printf '%s\n' "$OLD_CURRENT" > "$BACKUP/previous-release.txt"
OLD_RESTART=$(docker inspect --format '{{.HostConfig.RestartPolicy.Name}}{{if .HostConfig.RestartPolicy.MaximumRetryCount}}:{{.HostConfig.RestartPolicy.MaximumRetryCount}}{{end}}' "$QL_CONTAINER")
if [[ -n "$LEGACY_SERVICE" && "$LEGACY_SERVICE" != "$SERVICE" ]]; then
    systemctl cat "$LEGACY_SERVICE" >/dev/null || die '指定的旧服务不存在'
    LEGACY_ACTIVE=$(systemctl is-active "$LEGACY_SERVICE" || true)
    LEGACY_ENABLED=$(systemctl is-enabled "$LEGACY_SERVICE" || true)
fi
TRANSACTION=yes
systemctl stop "$SERVICE" 2>/dev/null || [[ "$OLD_ACTIVE" != active ]]
if [[ -n "$LEGACY_SERVICE" && "$LEGACY_SERVICE" != "$SERVICE" ]]; then systemctl stop "$LEGACY_SERVICE"; fi
# Refuse an unrelated npm/PM2 process instead of killing it by port number.
TOKEN_ADMIN_HOST=$TOKEN_ADMIN_HOST TOKEN_ADMIN_PORT=$TOKEN_ADMIN_PORT "$NODE_PATH" -e '
const s=require("net").createServer(); s.on("error",e=>{console.error("端口不可用，请先停止旧 npm/PM2 进程："+e.message);process.exit(1)});
s.listen(Number(process.env.TOKEN_ADMIN_PORT),process.env.TOKEN_ADMIN_HOST,()=>s.close());'
ln -s "$RELEASE" "$INSTALL_DIR/.next-link"
mv -Tf "$INSTALL_DIR/.next-link" "$INSTALL_DIR/current"
for key in INSTALL_DIR REPO BRANCH TOKEN_ADMIN_HOST TOKEN_ADMIN_PORT QL_CONTAINER QL_HIK_DAKA_PATH NODE_PATH AUTOSTART CONTAINER_AUTOSTART; do
    printf '%s=%s\n' "$key" "${!key}"
done > "$CONFIG"
chmod 600 "$CONFIG"
cat > "$UNIT" <<UNITFILE
[Unit]
Description=Hik Daka Token Admin
Wants=network-online.target docker.service
After=network-online.target docker.service
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR/current
EnvironmentFile=$CONFIG
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin
ExecStart=/bin/bash $INSTALL_DIR/current/start-linux.sh
Restart=always
RestartSec=10
UMask=0027

[Install]
WantedBy=multi-user.target
UNITFILE
systemctl daemon-reload
if [[ "$AUTOSTART" == yes ]]; then systemctl enable "$SERVICE"; else systemctl disable "$SERVICE"; fi
if [[ "$CONTAINER_AUTOSTART" == yes ]]; then docker update --restart unless-stopped "$QL_CONTAINER" >/dev/null; fi
systemctl restart "$SERVICE"
probe_host=$TOKEN_ADMIN_HOST
case "$probe_host" in 0.0.0.0) probe_host=127.0.0.1 ;; ::) probe_host='[::1]' ;; *:*) probe_host="[$probe_host]" ;; esac
ready=no
for ((attempt=0; attempt<30; attempt++)); do
    if systemctl is-active --quiet "$SERVICE" && curl --noproxy '*' -fsS --max-time 2 "http://$probe_host:$TOKEN_ADMIN_PORT/" -o "$TMP/page" 2>/dev/null && grep -q 'app.js' "$TMP/page"; then
        ready=yes; break
    fi
    sleep 1
done
[[ "$ready" == yes ]] || { journalctl -u "$SERVICE" -n 25 --no-pager >&2; die '新前端未能启动，正在回退'; }
if [[ -n "$LEGACY_SERVICE" && "$LEGACY_SERVICE" != "$SERVICE" ]]; then systemctl disable "$LEGACY_SERVICE"; fi
TRANSACTION=no
log "完成。访问 http://$probe_host:$TOKEN_ADMIN_PORT（局域网访问请替换为主机 IP）。"
log "前端自启=$AUTOSTART；Docker/青龙自启管理=$CONTAINER_AUTOSTART。配置：$CONFIG"
log "更新：sudo bash $INSTALL_DIR/current/install.sh update --yes"
log "日志：journalctl -u $SERVICE -n 100 --no-pager；旧版本及备份保留在 $INSTALL_DIR"
