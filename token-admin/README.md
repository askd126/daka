# Token 提交前端

这是一个零第三方依赖的局域网管理页面，用于验证海康 `www_token`，并自动写入青龙的多账号环境变量。默认监听 `0.0.0.0:5710`，手机和电脑均可在同一局域网内访问。

## 功能

- 提交前调用海康接口验证 Token，验证失败不会写入青龙。
- 自动依次创建 `HIK_DAKA_TOKEN`、`HIK_DAKA_TOKEN_2`、`HIK_DAKA_TOKEN_3`……
- 可同时填写本人的 Server酱 SendKey，与 Token **成对**写入（`HIK_DAKA_TOKEN_2` 配 `HIK_DAKA_PUSH_KEY_2`）；新账号留空只写 Token，已有账号留空保留原通知配置。
- 提交前按海康账号 ID 检查青龙环境变量；账号已存在时先提示，再次确认后更新原 Token，不会新增重复账号。
- SendKey 留空时不会新增或修改通知 Key；填写后需再次确认，才会为已有账号补配或更换 SendKey。
- 若旧 Token 已失效且未记录账号 ID，页面会提示无法核对的账号数量，新增前需再次确认。
- 启动时自动将 `ql_token_admin.cjs` 安装到青龙容器。
- Token 和 SendKey 都不写入 URL、浏览器存储或服务日志。
- 使用 CSRF 校验、安全响应头、请求大小限制和基础频率限制。

## 前置条件

1. 手动启动时需 Node.js 18 或更高版本；Linux 安装脚本可自动补装独立运行时。
2. Docker 可在当前终端直接使用。
3. 青龙容器正在运行，默认容器名为 `qinglong`。
4. 已运行本项目的青龙订阅，容器脚本目录中存在 `hik_daka.js`；支持订阅仓库子目录，无需复制到根目录。

## 启动

克隆仓库后进入目录：

```sh
cd daka/token-admin
npm start
```

该组件没有 npm 运行依赖，因此不需要执行 `npm install`。

启动成功后会显示：

```text
Token 管理页已启动：http://0.0.0.0:5710
```

访问地址：

- 本机：`http://127.0.0.1:5710`
- 局域网：`http://运行服务的电脑IP:5710`

## Ubuntu / Debian 自动安装与更新

适用于 **使用 systemd 的 Linux 主机**，在 Docker 宿主机执行，需要 `sudo`。先部署好 Docker 和青龙，并运行本项目订阅。脚本会自动补齐下载工具；优先使用已有 Node.js >=18，缺少时从 [Node.js 官方下载站](https://nodejs.org/en/download) 安装 Node.js 24 LTS 独立运行时并校验 SHA256。不会替换系统 Node，不需要 `npm install`。

### 全自动安装

```sh
curl -fsSL https://raw.githubusercontent.com/askd126/daka/main/token-admin/install.sh -o install-token-admin.sh
sudo bash install-token-admin.sh install --yes
```

或在最新仓库根目录直接运行：

```sh
sudo bash token-admin/install.sh install --yes --source "$PWD"
```

默认安装到 `/opt/hik-daka-token-admin`，监听 `0.0.0.0:5710`，立即启动并配置开机自启，无需登录系统。默认启用 Docker 自启，并把指定青龙容器设为 [`unless-stopped`](https://docs.docker.com/engine/containers/start-containers-automatically/)；手动停止青龙后不会自动重新启动，需自己 `docker start qinglong`。

访问 `http://主机局域网IP:5710`。脚本只启动服务，不会自动打开浏览器。页面仍仅供可信局域网使用。

### 交互安装与自定义选项

去掉 `--yes`，按提示选择安装目录、仓库、分支、地址、端口、容器和自启开关：

```sh
sudo bash token-admin/install.sh
```

自定义全自动安装示例：

```sh
sudo bash token-admin/install.sh install --yes \
  --container qinglong --port 5710 --host 0.0.0.0 \
  --autostart --no-container-autostart
```

`--no-container-autostart` 不更改 Docker 的开机启用状态及青龙容器的 restart 策略；需自行保证青龙在重启后可用。`--no-autostart` 仅关闭前端下次开机自启，本次仍立即启动。已有策略不会因这两个选项被重置。可用 `--node /绝对路径/node` 指定运行时。

脚本自动在青龙容器的 `/ql/data/scripts`、旧版 `/ql/scripts` 及订阅子目录中查找 `hik_daka.js`。如同时订阅 GitHub/Gitee 导致存在多份，会列出候选路径；用 `--core-path /ql/data/scripts/实际仓库/qinglong/hik_daka.js` 选择，配置在更新后保留。`--core-path auto` 恢复自动查找。

国内仓库安装/更新源可指定为 Gitee（请先确保镜像已同步新版脚本）：

```sh
sudo bash token-admin/install.sh install --yes --repo https://gitee.com/askd126/daka.git
```

`sh token-admin/install.sh ...` 也支持，脚本会自动转用 Bash。

### 更新与日常管理

```sh
# 下载所选仓库最新代码，沿用原端口、容器、安装目录及自启选项
sudo bash /opt/hik-daka-token-admin/current/install.sh update --yes

# 更新时调整设置，或不加 --yes 进入交互配置
sudo bash /opt/hik-daka-token-admin/current/install.sh update --yes --port 5711

# 查看状态、启动、停止、重启及最近 100 行日志
sudo bash /opt/hik-daka-token-admin/current/install.sh status
sudo bash /opt/hik-daka-token-admin/current/install.sh start
sudo bash /opt/hik-daka-token-admin/current/install.sh stop
sudo bash /opt/hik-daka-token-admin/current/install.sh restart
sudo bash /opt/hik-daka-token-admin/current/install.sh logs
```

这是**手动触发更新**；不会定时拉取代码。`install` 重复执行也会保留现有设置并安装新代码。`--source /路径/最新daka` 支持从本地代码更新；不传 `--source` 时使用持久保存的仓库和分支。运行时优先复用，不随前端更新自动升级 Node。

配置保存在 `/etc/hik-daka-token-admin.env`，服务名为 `hik-daka-token-admin.service`。也可直接使用 `systemctl`、`journalctl` 管理。服务等待青龙就绪后启动前端；等待 300 秒失败后由 systemd 重试。服务以 root 运行以访问 Docker，效果等同于以 `sudo` 手动启动前端。

更新先下载并检查代码，再切换版本、重启服务并检查 HTTP 页面。启动失败自动恢复上一个代码目录、配置及原服务状态；下载失败不会停止旧前端。更新时有短暂中断。`releases/` 和 `backups/` 保留旧版本与配置快照，不自动清理；确认稳定后可自行清理不再需要的历史目录，保留 `current` 指向的版本。

### 从旧版手动安装迁移

旧版使用 `git clone` + `npm start`，或自行创建 systemd 服务的，都可以用**最新仓库中的脚本**迁移到独立安装目录；原仓库及本地修改会保留。

先停止旧的手动 `npm start` / PM2 前端，再执行：

```sh
# /home/user/daka 是旧仓库；也可直接传旧 token-admin 目录
sudo bash token-admin/install.sh install --yes \
  --legacy-dir /home/user/daka --container qinglong --port 5710
```

若旧服务由 systemd 管理，脚本可以停止并接管它，成功后禁用旧服务，失败则恢复：

```sh
sudo bash token-admin/install.sh install --yes \
  --legacy-service 旧服务名 \
  --legacy-dir /home/user/daka

# 旧服务使用独立 EnvironmentFile 时，额外指定文件路径
sudo bash token-admin/install.sh install --yes \
  --legacy-service 旧服务名 --legacy-env /etc/old-token-admin.env
```

自动导入旧服务内联 `Environment=` 和旧目录 `.env` / `--legacy-env` 中的 `TOKEN_ADMIN_HOST`、`TOKEN_ADMIN_PORT`、`QL_CONTAINER`、`QL_HIK_DAKA_PATH`。导入顺序为：已有托管配置 → 旧服务内联设置 → 旧目录 `.env` → 指定旧配置文件 → 命令行参数。文件只按键值读取，不执行其中的 Shell 内容。旧版仅通过终端 `export` 设置过的值无法自动恢复，请用相应命令行参数明确传入。

若旧服务也叫 `hik-daka-token-admin`，仍需传 `--legacy-service hik-daka-token-admin` 允许接管。非托管的已有安装目录不会被覆盖；请用新 `--dir`，把原目录作为 `--legacy-dir`。端口被其他进程占用时脚本会报错并回退，不会按端口强杀进程。

青龙里的账号 Token、账号 ID 标记和通知 Key 存在青龙数据中，安装和更新不会重建容器、清空环境变量或覆盖旧仓库。完整参数见 `bash token-admin/install.sh --help`。

## Windows 开机自启（可选）

`windows-autostart.ps1` 会在登录后启动本服务，并且**先等 Docker 就绪再启动**——Docker Desktop 也在登录时启动，如果不等待，`docker exec` 会失败导致服务直接退出。

用仓库里的安装脚本注册计划任务（无需管理员权限）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-autostart-task.ps1
```

它会创建名为 `HikDaka-TokenAdmin` 的计划任务，触发条件为「当前用户登录时」，失败自动重试 3 次。也可以直接手动运行 `windows-autostart.ps1`。

运行日志在同目录：`autostart.log`（启动流程）、`autostart.out.log` / `autostart.err.log`（服务输出），均已被 `.gitignore` 的 `*.log` 忽略。

验证是否生效（重新登录后执行）：

```powershell
Get-ScheduledTaskInfo -TaskName 'HikDaka-TokenAdmin' | Select LastTaskResult   # 0 为成功
Get-Content .\autostart.log                                                     # 应有三行启动记录
```

不再需要自启时移除：

```powershell
Unregister-ScheduledTask -TaskName 'HikDaka-TokenAdmin' -Confirm:$false
```

> 注意：脚本文件带 UTF-8 BOM。Windows PowerShell 5.1 默认按 ANSI 读取 `.ps1`，没有 BOM 会让中文注释乱码并导致语法错误。

## 可选环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `TOKEN_ADMIN_HOST` | `0.0.0.0` | 监听地址；仅本机访问可改为 `127.0.0.1` |
| `TOKEN_ADMIN_PORT` | `5710` | 页面端口 |
| `QL_CONTAINER` | `qinglong` | 青龙 Docker 容器名称 |
| `QL_HIK_DAKA_PATH` | 自动查找 | 容器内核心脚本绝对路径；有多份 `hik_daka.js` 时需显式选择 |

PowerShell 示例：

```powershell
$env:QL_CONTAINER="qinglong"
$env:TOKEN_ADMIN_PORT="5710"
npm start
```

Linux/macOS 示例：

```sh
QL_CONTAINER=qinglong TOKEN_ADMIN_PORT=5710 npm start
```

若旧版提示固定路径 `/ql/data/scripts/hik_daka.js` 不存在，先更新仓库，然后使用**仓库中的新版安装脚本**执行安装/更新，以替换旧的固定路径预检。可用以下命令检查容器中的实际位置：

```sh
docker exec qinglong find /ql/data/scripts -type f -name hik_daka.js
```

有多份时，手动启动可设置 `QL_HIK_DAKA_PATH`，托管安装可传 `--core-path`。不需要把订阅文件复制成根目录的旧副本。

## 获取 Token

1. 打开 <https://www.hikiot.com/portal/login>。
2. 使用与海康物联小程序相同的手机号和短信验证码登录。
3. 登录后按 `F12`，进入“应用程序（Application）”。
4. 在“存储 → Cookie”中选择 `https://www.hikiot.com`。
5. 找到 `www_token`，复制其 36 位值并提交到管理页面。

## 安全边界

此页面没有用户登录系统。任何能够访问端口的人都可以向青龙提交有效 Token，因此：

- 只在本人控制的可信局域网中运行。
- 不要将 `5710` 端口映射到公网。
- 不要使用公网反向代理、内网穿透或公共隧道暴露此页面。
- 若只需本机操作，将 `TOKEN_ADMIN_HOST` 设置为 `127.0.0.1`。
- 停止服务后页面立即不可访问；已保存的 Token 仍保留在青龙环境变量中。

## 文件结构

```text
token-admin/
├── server.cjs              # HTTP 服务与静态页面服务器
├── ql_token_admin.cjs      # 青龙环境变量读写辅助程序
├── package.json
├── install.sh              # Linux 安装、更新、迁移与 systemd 管理
├── start-linux.sh          # 等待青龙就绪并启动前端
├── install.test.sh         # 一次性 Linux 容器安装集成测试
└── public/
    ├── index.html
    ├── app.js
    └── styles.css
```

本目录使用仓库根目录的 MIT License 开源。


### 高级选项：自动登录

管理页高级选项填写海康手机号账号与密码，启用时立即验证并更新青龙 Token（官方 www_token Cookie 的值）。已有账号仍需再次确认，不修改 SendKey。后台每小时检查，成功后每 10 天更新，重启补查；失败保留原 Token，间隔至少一小时重试。服务须持续运行，关闭浏览器不影响更新。

密码不保存在前端或仓库。服务端使用 AES-256-GCM 加密，默认状态目录为运行用户的 ~/.hik-daka-token-admin，可通过 TOKEN_ADMIN_STATE_DIR 指定。key 与 accounts.enc 须一起保护和备份；Linux 文件权限 600、目录 700，Windows 应限制运行用户目录访问。Linux 更新保留家目录中的状态，切换运行用户时须迁移状态目录。持有密钥与状态文件的用户可以解密密码。

停用时填写账号并点击删除保存的密码，保留青龙原 Token。官方要求人工验证或密码变更时须处理后重新启用。只在可信网络或 HTTPS 下提交凭据，页面不会预填密码。


#### 提前过期时自动恢复

青龙任务检测到 Cookie 失效后，使用已保存密码自动登录一次，成功则更新原 Token 并继续当前账号处理。同一枚失效 Cookie 只尝试一次，重跑与重启仍去重。恢复失败后暂停该账号自动尝试，需要重新保存凭据；未配置密码的账号只提醒一次。

恢复结果仅走个人通知一次，没有个人 Key 时走系统汇总一次，不再同时推送两份恢复明细。每次失效事件最多一次通知发送尝试，网络失败不保证送达；其他账号日常通知保持原逻辑。`--check` 模式不触发恢复或通知。

服务启动时在青龙 `/ql/data/config/hik-auto-login-bridge.json` 安装内部接口地址及随机认证密钥，权限 600。接口地址默认使用容器网关与服务端口，因此宿主服务需监听可从 Docker 网络访问的地址。不要公开桥接密钥或把此配置纳入公开仓库。
