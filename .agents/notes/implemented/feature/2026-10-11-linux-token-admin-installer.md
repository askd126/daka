# Agent Note: Linux 前端安装、更新与旧版迁移

Status: implemented

## Problem

Token 管理前端原先只提供 npm 手动启动及 Windows 登录启动。Ubuntu 用户需要自行准备 Node、编写 systemd 单元和更新仓库，旧目录、端口和容器配置容易在迁移中丢失。

## Decision

`token-admin/install.sh` 提供 Linux + systemd 的安装与更新管理，默认交互，`--yes` 沿用现有设置或默认值。安装目录包含独立 releases、current 符号链接和 backups；配置独立放在 `/etc/hik-daka-token-admin.env`，不通过 source 读取任何旧配置。优先复用 Node >=18，缺少时下载官方 Node 24 LTS 二进制并校验 SHA256，安装到专用目录。

更新在临时目录获取代码并检查语法后才停止旧服务。切换 current 后检查真实 HTTP 页面；失败恢复版本链接、配置、单元和原服务活动/启用状态。旧发布和配置快照保留，不自动删除。下载失败保持旧服务运行。

默认启用前端和 Docker 自启并将指定青龙容器设为 unless-stopped，均可选择关闭管理。systemd 只管理宿主机前端，等待青龙文件就绪；不通过 systemd 拉起容器，以免与 Docker restart 策略竞争。root 服务沿用现有 Docker CLI 访问模型，不向局域网提供安装控制接口。

旧版通过 `--legacy-dir`、`--legacy-env`、`--legacy-service` 显式迁移。仅导入三个前端环境设置，命令行参数优先；旧服务成功后禁用，失败恢复。原仓库、本地改动与青龙账号数据保留。无法还原旧终端 export 值，要求显式传入；不按端口杀掉未知进程。

## Related decisions

已有 [Windows 自启可移植性记录](../bug-fix/2026-10-10-windows-autostart-portability.md) 部分重叠，保留并互链：Windows 是登录触发，本记录是 Linux systemd 启动与版本生命周期。[账号检测记录](2026-10-11-token-account-detection.md) 属于账号写入契约，与安装工具无行为替代关系。检索未发现其他 Linux 安装提案。

## Alternatives considered

- 在原仓库直接 git pull 并 npm start 最简单，但会与旧工作区本地修改冲突，缺少失败回退；选择独立发布目录。
- 使用系统 apt 安装 Node 易维护，但旧 Ubuntu 源可能无法提供 Node >=18；缺失运行时时下载独立官方运行时，避免更换系统 Node。
- 自动安装/重建 Docker 和青龙能覆盖全新主机，但可能改变现有面板与数据布局；前端安装仅要求已有 Docker、青龙及订阅。

## Consequences

配置在更新中持久化，手动部署能够迁移，自启不依赖登录。代价是需要 root、systemd 以及下载网络，更新有短暂服务中断，历史版本占用磁盘需自行清理。前端更新不自动升级 Node。Docker 启用/启动属于用户选择的宿主机准备动作；代码激活失败时恢复容器原 restart 策略，但不关闭 Docker。页面继续只在可信局域网运行。

## Verification

一次性 Linux 容器中以模拟 systemctl/Docker 和真实 Node/HTTP 覆盖安装、缺失运行时安装与坏校验拒绝、更新保留设置、仓库切换、下载失败不中断、运行失败回退、旧配置/服务迁移和端口冲突保护。容器不挂载 Docker socket，不接触真实青龙数据。此测试不等于 Ubuntu 实机重启验证。既有 Node 前端测试及语法检查继续运行。
