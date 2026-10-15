# Agent Note: Cookie 过期通知脱敏与重试终止

Status: implemented

## Problem

部署服务器 2026-10-15 的下班任务中，第二个账号返回 HTTP 401 Invalid access token，日志及推送正文包含完整失效 Token。第一账号正常，不属于任务整体故障。

## Decision

海康 HTTP 401、业务 code 401 和明确的登录失效消息归为 AUTH_EXPIRED，通知改为登录过期或失效及管理页更新 Cookie 的操作提示。账号校验及打卡提交遇到该错误立即停止重试。其他错误保留诊断信息并遮蔽 UUID；403 权限不足、网络异常与认证过期分开处理。

## Alternatives considered

仅替换推送文案改动较少，但日志仍泄露 Token 且仍无意义重试，因此在 API 错误构造处统一处理。把所有 403 归为登录过期容易误导权限故障，故不采用。

## Consequences

登录过期仍计为失败，不伪造打卡成功，不发送额外测试通知。官方风控和网络失败仍需独立排障。旧日志保留用于审计，新日志避免回显 Token。部署前备份原脚本，前端使用现有安装器更新并保留旧 release。

## Related decisions

检索既有通知与网页防护笔记，均为部分相关而非替代：[汇总通知](2026-09-29-qinglong-summary-notification.md)、[网页状态防护](2026-10-10-web-admin-safeguards.md)。未发现相同提案。

## Testing

测试覆盖 HTTP 和业务 401、日志和推送脱敏、不重试，以及 403 与 500 不误判。真实登录验证只读取账号与配置，不提交打卡、不发送通知。


## Deployment verification

2026-10-15 通过 SSH 更新 192.168.1.125 的 systemd 前端及青龙订阅目录核心脚本，保留旧 release 与原脚本。核心脚本部署 SHA256 为 02f9ab6070df1f493617412962cb4b5d701680775c7342a1ed8f883451ffd7ea。真实过期 Token 返回 AUTH_EXPIRED，通知预览不含 Token，未发送测试通知。

用户明确确认将所提供账号绑定至 HIK_DAKA_TOKEN 后，迁移账号 ID 备注并启用自动登录。新 Token 只读校验成功，账号数保持 2，其他变量值、备注及状态保持不变。systemd 重启后加密状态恢复正常。第二账号 HikMall_44047330 仍过期，未提供其凭据。登录测试会使旧会话失效，因此后续验证读取已保存 Token，避免再次账号密码登录破坏刚保存的会话。GitHub 本次提交包含核心脚本修复，后续订阅需拉取包含本修复的版本。

提前过期的单次恢复与通知去重见 [Cookie 失效恢复](../feature/2026-10-15-expired-cookie-recovery.md)。
