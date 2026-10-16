# Agent Note: 账号密码自动登录与十天 Cookie 更新

Status: implemented

## Problem

手动复制 Cookie 无法持续维护青龙 Token，需要前端配置账号密码自动登录。

## Decision

管理页高级表单调用官方 pwdLogin 接口，遵循官方 CryptoJS 协议。后台每小时检查，成功十天后刷新，重启补查，失败一小时后重试。刷新检测账号并绑定既有 envName，拒绝静默新增或改绑。首次配置仍受已有账号确认门约束，SendKey 不变。

服务端 AES-256-GCM 加密凭据，独立保存密钥，状态目录在运行用户家目录或显式持久目录。响应不返回密码或 Token。Linux 安装随附 CryptoJS 及许可证，无需安装 npm 依赖。

## Alternatives considered

浏览器定时器便于集成，但关闭页面不能执行，故采用后台调度。浏览器保存密码无法支持无人值守，选择服务端加密持久化。原生 AES 无法直接匹配官网非标准长度 CryptoJS 密钥，故随附现有依赖实现及许可证。

## Consequences

服务必须持续运行；风控或人工验证需要用户处理。加密防止直接读取状态文件中的密码，但持有密钥和状态的服务用户仍能解密。十天时序通过模拟时间验证，真实长期运行仍待观察。

## Related decisions

现有 [账号检测](2026-10-11-token-account-detection.md) 与 [Linux 安装](2026-10-11-linux-token-admin-installer.md) 部分重叠，保留其确认门与部署契约。本记录补充调度和凭据持久化；其他网页修复无替代关系，未发现相同提案。

## Testing

提供的凭据完成一次官方接口真实登录，未输出或保存 Token。测试覆盖确认门、十天边界、加密、重启恢复、失败退避、删除凭据和绑定变更。

提前过期的单次恢复与通知去重见 [Cookie 失效恢复](2026-10-15-expired-cookie-recovery.md)。

密码重登须建立团队会话并通过考勤接口验证，见 [考勤团队登录修复](../bug-fix/2026-10-16-login-attendance-team-context.md)。
