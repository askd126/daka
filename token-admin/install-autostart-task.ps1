# 一次性安装脚本：注册「登录时启动 Token 管理页」的计划任务。
$ErrorActionPreference = 'Stop'

$taskName = 'HikDaka-TokenAdmin'
$scriptPath = 'D:\HaiKang\daka\token-admin\windows-autostart.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "找不到启动脚本：$scriptPath"
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# 不限执行时长（启动后常驻）、失败重试 3 次
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description '登录时启动海康打卡 Token 管理页（端口 5710）' -Force | Out-Null

Write-Output "已注册计划任务：$taskName"
