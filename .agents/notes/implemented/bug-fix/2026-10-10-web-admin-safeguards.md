# Agent Note: 网页打卡与 Token 管理页的状态防护

Status: implemented

## Problem

网页定时器可能错过午夜刷新，失败响应可能掩盖已成功的打卡。仅检查 Token 长度会放过格式错误的输入。Token 管理页的状态接口每次都会调用 Docker，且返回了页面不需要的环境变量名；青龙不同版本的 `updateEnv` 对错误参数可能直接抛出异常。

## Decision

网页定时检查时重新计算当天计划，失败后读取今日状态复核；Token 采用 UUID 格式校验，退出时清理账号状态及定时器，定位随机点均匀分布在配置半径内。Token 管理页对状态请求单独限流并去掉 `envNames`；更新环境变量时先试单对象参数，再试数组参数，即使第一次调用抛错也继续第二种形式。Vercel 静态页面增加基础响应头。

## Alternatives considered

沿用只在午夜定时刷新的方式更省一次本地计算，但浏览器休眠后可能继续使用前一天计划。只依赖一种 `updateEnv` 参数形式更简单，却会排除另一种青龙版本。

## Consequences

状态接口在一分钟内超过 20 次请求时返回 429。网页失败后复核会增加一次状态查询；若该查询失败，仍按原重试流程处理。上述网页与管理页改动不改变已保存的 Token。

## Verification

`npm run build` 验证 Vue 页面，`npm run check --prefix token-admin` 验证管理页脚本，`vercel.json` 通过 JSON 解析。
