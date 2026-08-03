<#
.SYNOPSIS
    本地远程部署脚本 - 通过 SSH 连接服务器更新墨笔小说助手部署代码

.DESCRIPTION
    在本地执行，通过 SSH 远程触发服务器上的 hot-deploy.sh / auto-update.sh。
    前提：已配置 SSH 密钥免密登录 root@43.255.122.252。
    服务器项目路径默认 /opt/1panel/apps/novel-assistant（依据 auto-update.sh 日志路径推断）。

.PARAMETER Mode
    menu      : 交互菜单（默认）
    hot       : 热更新 = 构建前端 + 重启容器，约10秒
    full      : 完整更新 = 拉代码 + 修迁移 + 构建前端 + 重启，约几分钟
    backend   : 仅重启后端，约3秒（源码已通过 volume 挂载，重启即生效）
    frontend  : 仅构建前端（刷新浏览器即生效）

.EXAMPLE
    .\deploy.ps1                       # 弹出交互菜单
    .\deploy.ps1 -Mode hot             # 热更新
    .\deploy.ps1 -Mode full            # 完整更新（拉代码+迁移+构建+重启）
    .\deploy.ps1 -Mode backend         # 仅重启后端
    .\deploy.ps1 -Mode frontend        # 仅构建前端
#>

param(
    [ValidateSet('menu','hot','full','backend','frontend')]
    [string]$Mode = 'menu',

    [string]$SshUser    = 'root',
    [string]$SshHost    = '43.255.122.252',
    [int]   $Port       = 22,
    [string]$ProjectDir = '/opt/1panel/apps/novel-assistant',
    [int]   $HealthPort = 8000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step($msg) { Write-Host "`n[步骤] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!]    $msg" -ForegroundColor Yellow }
function Die($msg)        { Write-Host "[X]    $msg" -ForegroundColor Red; exit 1 }

# 0. 交互菜单
if ($Mode -eq 'menu') {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "  墨笔 - 远程部署到 $SshHost" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  1. 热更新（默认，约10秒）   构建前端 + 重启容器"
    Write-Host "  2. 仅重启后端（约3秒）       改了后端代码用"
    Write-Host "  3. 仅构建前端                改了前端代码用"
    Write-Host "  4. 完整更新（几分钟）        拉代码+迁移+构建+重启"
    Write-Host "  0. 退出"
    Write-Host ""
    $choice = Read-Host "请选择 [1/2/3/4/0]（回车默认1）"
    switch ($choice) {
        '0'  { exit 0 }
        '2'  { $Mode = 'backend' }
        '3'  { $Mode = 'frontend' }
        '4'  { $Mode = 'full' }
        default { $Mode = 'hot' }
    }
}

# 1. 检查 ssh 客户端
if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Die "未找到 ssh 命令。请启用 Windows OpenSSH 客户端：设置 > 应用 > 可选功能 > 添加 'OpenSSH 客户端'"
}

# 2. 根据模式确定远程命令
switch ($Mode) {
    'hot'      { $remote = 'bash hot-deploy.sh all' }
    'full'     { $remote = 'bash auto-update.sh' }
    'backend'  { $remote = 'bash hot-deploy.sh backend' }
    'frontend' { $remote = 'bash hot-deploy.sh frontend' }
}

$target = "$SshUser@$SshHost"

Write-Step "连接 ${target}:$Port"
Write-Host "    项目目录: $ProjectDir" -ForegroundColor DarkGray
Write-Host "    更新模式: $Mode" -ForegroundColor DarkGray
Write-Host "    远程命令: $remote" -ForegroundColor DarkGray

# 3. 先验证 SSH 连通性（快速失败，避免卡在后续命令）
Write-Step "验证 SSH 连通性..."
& ssh -p $Port -o BatchMode=yes -o ConnectTimeout=8 $target "echo connected"
if ($LASTEXITCODE -ne 0) {
    Die "SSH 连接失败（退出码 $LASTEXITCODE）。请确认密钥已配置免密登录，或执行: ssh -p $Port $target 手动测试"
}
Write-Ok "SSH 连接正常"

# 4. 执行远程部署
Write-Step "执行远程部署..."
& ssh -p $Port $target "cd `"$ProjectDir`" && $remote"
if ($LASTEXITCODE -ne 0) {
    Die "远程部署执行失败（退出码 $LASTEXITCODE）"
}
Write-Ok "远程命令执行完成"

# 5. 健康检查
$healthUrl = "http://${SshHost}:$HealthPort/health"
Write-Step "健康检查 $healthUrl"
$ok = $false
for ($i = 1; $i -le 30; $i++) {
    try {
        $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3 -ErrorAction Stop
        if ($resp.ok) { $ok = $true; break }
    } catch {
        Write-Host "." -NoNewline
    }
    Start-Sleep -Seconds 1
}
Write-Host ""
if ($ok) {
    Write-Ok "服务健康检查通过"
} else {
    Write-Warn "健康检查超时（30秒），请稍后手动访问 $healthUrl 确认服务状态"
}

# 6. 显示服务器当前版本
Write-Step "服务器当前版本"
& ssh -p $Port $target "cd `"$ProjectDir`" && git log -1 --oneline"
Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "  部署完成！访问 http://${SshHost}:$HealthPort" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
