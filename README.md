# 海康青龙自动打卡

面向青龙面板的海康物联多账号自动考勤项目。通过公开 GitHub 仓库订阅后，青龙会自动创建上、下班任务；每个面板只需配置账号 Token，定位、时间和随机延迟均已提供默认值。

> 请仅在本人有权使用的账号与考勤规则范围内运行，并遵守所在单位的相关制度。

## 功能

- 青龙公开仓库订阅，自动添加和更新任务。
- 支持 `HIK_DAKA_TOKEN`、`HIK_DAKA_TOKEN_2` 等多账号变量。
- 每天查询官方节假日，官方节假日跳过；普通周末仍按海康考勤规则判断。
- 上班随机等待 0–5 分钟，下班随机等待 0–40 分钟。
- 提交前检查今日状态，避免重复打卡。
- 所有账号结果合并为一条青龙系统通知，可使用已配置的 Server酱等通知渠道。
- 提供开源的局域网 Token 提交页面，验证后自动写入青龙。

## 一、添加青龙订阅

进入青龙面板的“订阅管理”，新建公开仓库订阅：

| 配置项 | 内容 |
| --- | --- |
| 名称 | `海康自动打卡` |
| 类型 | `公开仓库` |
| 仓库地址 | `https://github.com/askd126/daka.git` |
| 分支 | `main` |
| 定时类型 | `crontab` |
| 定时规则 | `0 3 * * *` |
| 白名单 | `qinglong/subscription/hik_daka_` |
| 黑名单 | 留空 |
| 依赖文件 | `qinglong/hik_daka.js` |
| 文件后缀 | `js` |
| 自动添加任务 | 开启 |
| 自动删除失效任务 | 开启 |

保存后手动运行一次订阅。成功后会自动创建：

| 任务 | 定时 | 执行范围 |
| --- | --- | --- |
| 海康上班打卡 | `15 8 * * *` | 08:15–08:20 |
| 海康下班打卡 | `30 21 * * *` | 21:30–22:10 |

更完整的字段说明和排错方法见 [青龙订阅部署文档](./qinglong/SUBSCRIPTION.md)。

## 二、添加账号 Token

在青龙“环境变量”页面新增并启用：

```text
名称：HIK_DAKA_TOKEN
值：账号的 www_token
```

添加其他账号时继续使用：

```text
HIK_DAKA_TOKEN_2
HIK_DAKA_TOKEN_3
HIK_DAKA_TOKEN_4
```

仓库不会保存任何账号 Token。脚本内置了公开默认定位；如需使用其他地点，可通过 `HIK_DAKA_LOCATION`、`HIK_DAKA_LONGITUDE`、`HIK_DAKA_LATITUDE` 等变量覆盖，详见 [青龙脚本文档](./qinglong/README.md)。

## 三、获取 Token

1. 打开 <https://www.hikiot.com/portal/login> 并登录。
2. 按 `F12` 打开开发者工具。
3. 进入“应用程序（Application）→ 存储 → Cookie”。
4. 选择 `https://www.hikiot.com`。
5. 找到 `www_token`，复制其 36 位值。

## 四、首次安全检查

在自动创建的任务命令末尾临时添加：

```text
--check
```

手动运行任务。检查模式只验证 Token、节假日和今日状态，不会提交打卡或发送汇总通知。确认日志正常后移除 `--check`。

## 五、Token 提交前端

仓库包含开源的局域网 Token 管理页面：

```sh
git clone https://github.com/askd126/daka.git
cd daka/token-admin
npm start
```

默认监听 `0.0.0.0:5710`。页面会验证 Token，并自动保存为下一个可用的青龙多账号变量。该页面没有登录系统，只能在可信局域网内使用，禁止映射到公网。

完整安装、环境变量和安全说明见 [Token 提交前端文档](./token-admin/README.md)。

## 目录说明

```text
qinglong/                 青龙核心脚本、订阅入口与部署文档
token-admin/              开源 Token 提交前端及青龙辅助程序
docs/original-web.md      原版 Vue/Vercel 网页打卡工具说明
src/                      原版 Vue 前端源码
```

原版 Vue 网页打卡工具仍保留在仓库中，部署方法已移至 [原版网页说明](./docs/original-web.md)。

## 开源许可

本项目使用 [MIT License](./LICENSE)。
