# 原版网页打卡工具

> 本页保留仓库原版 Vue 网页打卡工具的部署说明。仓库首页现以青龙订阅方案为主。[返回项目首页](../README.md)

一个基于 Vue 3 + Vite 的前端打卡工具，无需独立后端，直接部署到 Vercel 即可使用。

## 功能特性

- 自动打卡，支持定时任务
- 支持多语言（中文/英文）
- 支持 Supabase 数据库集成，遥测打卡状态
- 一键部署到 Vercel

## 部署到 Vercel

### 方式一：一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/askd126/daka)

1. 点击上方 **Deploy** 按钮。
2. 登录或注册 Vercel 账号。
3. Vercel 会自动 Fork 本仓库到你的 GitHub 账号，并进入部署向导。
4. 在 **Configure Project** 页面按需填写环境变量，也可以部署后再添加。
5. 点击 **Deploy**，等待构建完成。
6. 部署成功后，使用 Vercel 分配的 `*.vercel.app` 域名访问。

### 方式二：手动导入

1. 将本仓库 Fork 到自己的 GitHub 账号。
2. 打开 <https://vercel.com/new>，选择 **Import Git Repository**。
3. **Framework Preset** 选择 `Vite`。
4. 使用以下构建设置：
   - Build Command：`vite build`
   - Output Directory：`dist`
   - Install Command：`npm install`
5. 按需添加环境变量。
6. 点击 **Deploy**。

## 环境变量

项目根目录的 `vercel.json` 已为功能开关设置默认值。如需开启相关功能，在 Vercel 控制台覆盖对应变量即可。

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_ENABLE_SUPABASE_LOG` | `false` | 是否启用 Supabase 日志记录 |
| `VITE_ENABLE_TIME_RESTRICTION` | `false` | 是否启用凌晨 02:00–08:30 打卡限制 |
| `VITE_SUPABASE_KEY` | — | 启用 Supabase 日志记录时使用的匿名密钥 |

Supabase 配置详见 [README_SUPABASE.md](../README_SUPABASE.md)。

## 本地开发

```sh
npm install
npm run dev
```

生产构建：

```sh
npm run build
```

本地环境变量示例：

```dotenv
VITE_ENABLE_SUPABASE_LOG=false
VITE_ENABLE_TIME_RESTRICTION=false
VITE_SUPABASE_KEY=your-supabase-anon-key
```

## 技术栈

- Vue 3
- Vite
- TDesign Mobile Vue
- Supabase（可选）

本功能使用仓库根目录的 MIT License 开源。
