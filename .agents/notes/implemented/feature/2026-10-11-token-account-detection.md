# Agent Note: Token 管理页按海康账号 ID 判重

Status: implemented

## Problem

旧逻辑只比较 Token 字符串。同一海康账号刷新 Token 后会被当作新账号，写入下一组青龙变量；已存在账号填写 SendKey 时也会直接改写通知变量，页面没有提交前的提示。

## Decision

管理页在写入前通过青龙 helper 检测账号。helper 以海康返回的 `accountNo` 作为身份：新建的 Token 变量备注写入可解析的账号 ID；旧变量没有该备注时，尝试用其仍有效的 Token 查询账号 ID。完全相同的 Token 直接识别为已存在。

已有账号的 Token 更新或通知 Key 补配、替换都需要页面再次确认，且 helper 也拒绝未经确认的更新。SendKey 留空时，新账号只创建 Token 变量；已有账号更新 Token 时不创建、不修改原通知变量。旧 Token 失效且没有账号 ID 备注时无法安全判断身份，页面显示无法核对的数量，新增前要求再次确认。

## Alternatives considered

仅按 Token 判重无需查询旧账号，但无法识别刷新后的 Token。按昵称或备注中的姓名自动合并可以覆盖失效的旧 Token，却可能误合并同名账号，因此不自动采用。

## Consequences

旧变量首次按账号 ID 检测可能增加海康接口请求；新建或更新后的变量通过备注记录 ID，后续检测不再依赖旧 Token 的有效性。账号检测接口只返回存在状态、账号名、变量名、无法核验的数量及是否有通知 Key，不返回已保存的 Token 或 SendKey。旧账号身份不可核验时仍允许用户明确确认后新增，可能需要事后人工去重。

## Verification

`npm test --prefix token-admin` 验证同账号刷新 Token、无通知 Key 不写入、已有账号需确认及旧账号不可核验时的提示路径；`npm run check --prefix token-admin` 验证服务及前端脚本语法。

账号密码更新与凭据持久化见 [自动登录与十天 Cookie 更新](2026-10-15-auto-login-cookie-refresh.md)，沿用本文的既有契约。
