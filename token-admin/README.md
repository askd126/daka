# Token 提交前端

这是一个零第三方依赖的局域网管理页面，用于验证海康 `www_token`，并自动写入青龙的多账号环境变量。默认监听 `0.0.0.0:5710`，手机和电脑均可在同一局域网内访问。

## 功能

- 提交前调用海康接口验证 Token，验证失败不会写入青龙。
- 自动依次创建 `HIK_DAKA_TOKEN`、`HIK_DAKA_TOKEN_2`、`HIK_DAKA_TOKEN_3`……
- 自动识别重复 Token，不会重复保存。
- 启动时自动将 `ql_token_admin.cjs` 安装到青龙容器。
- Token 不写入 URL、浏览器存储或服务日志。
- 使用 CSRF 校验、安全响应头、请求大小限制和基础频率限制。

## 前置条件

1. 已安装 Node.js 18 或更高版本。
2. Docker 可在当前终端直接使用。
3. 青龙容器正在运行，默认容器名为 `qinglong`。
4. 已运行本项目的青龙订阅，容器中存在 `/ql/data/scripts/hik_daka.js`。

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

## 可选环境变量

| 名称 | 默认值 | 说明 |
| --- | --- | --- |
| `TOKEN_ADMIN_HOST` | `0.0.0.0` | 监听地址；仅本机访问可改为 `127.0.0.1` |
| `TOKEN_ADMIN_PORT` | `5710` | 页面端口 |
| `QL_CONTAINER` | `qinglong` | 青龙 Docker 容器名称 |

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
└── public/
    ├── index.html
    ├── app.js
    └── styles.css
```

本目录使用仓库根目录的 MIT License 开源。
