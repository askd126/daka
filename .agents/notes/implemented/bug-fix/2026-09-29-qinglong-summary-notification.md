# Agent Note: 汇总通知使用青龙系统接口

Status: implemented

## Problem

订阅脚本在任务环境没有全局 `QLAPI` 时调用 `sendNotify.js`。该模块读取脚本进程环境变量，与青龙面板的通知配置不一定相同；没有可用渠道时也可能正常返回，使任务误报“汇总通知已发送”。个人 SendKey 推送成功不能证明汇总通知已送达。

## Decision

汇总通知始终调用青龙的 `systemNotify`。任务已有支持该方法的全局 `QLAPI` 时直接使用；否则加载容器内的 `shell/preload/client.js`，调用后关闭自行创建的客户端。只有接口返回 `code: 200` 才记录成功，其余响应记录失败。个人推送继续使用每个账号自己的 SendKey。

## Alternatives considered

继续调用青龙附带的 `sendNotify.js` 最容易兼容已有脚本，但它直接读取进程环境变量，且无渠道或渠道内部失败时可能不抛错，无法代表面板通知的结果，因此不再用来发送汇总。

## Consequences

汇总遵循青龙面板中的通知配置，任务日志能区分系统接口确认成功和失败。运行环境需要青龙 `systemNotify` 客户端；若客户端不可用，汇总明确失败，而账号打卡结果仍照常完成。

## Verification

使用模拟青龙客户端分别验证 `code: 200` 和错误响应；运行 `node --check qinglong/hik_daka.js`，并确认文档描述与调用路径一致。
