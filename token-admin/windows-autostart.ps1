# 开机自启：等待 Docker 就绪后启动 Token 管理页（默认端口 5710）。
# 由「任务计划程序」在登录时调用，也可以手动执行。
# 日志写在同目录的 autostart*.log（仓库 .gitignore 已忽略 *.log）。

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $here 'autostart.log'
$port = 5710

function Write-Log([string]$message) {
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message" | Add-Content -LiteralPath $log -Encoding utf8
}

function Test-Port([int]$target) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $target)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

if (Test-Port $port) {
    Write-Log "端口 $port 已在监听，无需重复启动"
    exit 0
}

# Docker Desktop 也会在登录时启动，这里要等它的引擎真正可用，
# 否则 server.cjs 里的 docker exec 会失败并直接退出。
Write-Log '等待 Docker 就绪（最多 5 分钟）…'
$dockerReady = $false
for ($i = 1; $i -le 60; $i++) {
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { $dockerReady = $true; break }
    Start-Sleep -Seconds 5
}
if (-not $dockerReady) {
    Write-Log 'Docker 5 分钟内未就绪，本次不启动'
    exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Log '未找到 node，请确认已安装 Node.js 并加入 PATH'
    exit 1
}

Write-Log 'Docker 已就绪，启动 Token 管理页'
Start-Process -FilePath $node -ArgumentList 'server.cjs' -WorkingDirectory $here -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $here 'autostart.out.log') `
    -RedirectStandardError (Join-Path $here 'autostart.err.log')

Start-Sleep -Seconds 3
if (Test-Port $port) {
    Write-Log "启动成功，端口 $port 已监听"
} else {
    Write-Log "启动后端口 $port 仍未监听，请查看 autostart.err.log"
    exit 1
}
