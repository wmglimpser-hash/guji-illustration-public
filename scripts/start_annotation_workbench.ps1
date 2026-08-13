$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$url = "http://127.0.0.1:5678/"
$dataDir = (Resolve-Path (Join-Path $root "demo\data")).Path
$datasetId = "reannotation-v1-full"
$datasetLabel = "完整书库 · 新版重标"
$expectedBookCount = @(
    Get-ChildItem -LiteralPath (Join-Path $dataDir "books") -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName "book.json") }
).Count
if (-not $env:TCM_ILLUSTRATION_ASSET_ROOT) {
    $env:TCM_ILLUSTRATION_ASSET_ROOT = Join-Path $root "paozhifang\art_2d"
}

function Get-WorkbenchStatus {
    try {
        return Invoke-RestMethod -Uri ($url + "api/status") -Method Get -TimeoutSec 2
    }
    catch {
        return $null
    }
}

function Open-Workbench {
    # 显式交给 Windows Explorer 打开默认浏览器，避免部分受控终端直接
    # Start-Process URL 时出现“拒绝访问”，但服务其实已经正常启动。
    Start-Process -FilePath "explorer.exe" -ArgumentList $url
}

$status = Get-WorkbenchStatus
if ($status -and
    $status.data_source.id -eq $datasetId -and
    $status.data_source.path -eq $dataDir -and
    $status.data_source.book_count -eq $expectedBookCount -and
    $status.data_source.read_only -eq $false -and
    $status.asset_bridge.configured -eq $true) {
    Open-Workbench
    Write-Host "新版标注库已经运行，正在打开浏览器。"
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($processInfo.CommandLine -notmatch "demo[\\/]bridge\.py") {
        throw "端口 5678 被其他程序占用，未自动停止：$($processInfo.CommandLine)"
    }
    try {
        Invoke-RestMethod -Uri ($url + "api/backup-now") -Method Post -TimeoutSec 30 | Out-Null
    }
    catch {
        throw "当前标注数据备份失败，已取消切换。"
    }
    # Windows 上 0.0.0.0 监听曾留下多个同命令 bridge 进程；只停止当前
    # OwningProcess 会让另一个旧进程继续响应，造成刷新后数据集“随机切换”。
    $oldProcessIds = @(
        Get-CimInstance Win32_Process |
            Where-Object {
                $_.CommandLine -eq $processInfo.CommandLine -and
                $_.CommandLine -match "demo[\\/]bridge\.py"
            } |
            Select-Object -ExpandProperty ProcessId
    )
    if (-not $oldProcessIds) {
        $oldProcessIds = @($listener.OwningProcess)
    }
    Stop-Process -Id $oldProcessIds -Force
    foreach ($oldProcessId in $oldProcessIds) {
        Wait-Process -Id $oldProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }

    $releaseDeadline = (Get-Date).AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 200
        $remainingListener = Get-NetTCPConnection -LocalPort 5678 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -First 1
    } until (-not $remainingListener -or (Get-Date) -gt $releaseDeadline)
    if ($remainingListener) {
        throw "旧标注服务未能释放端口 5678，已取消启动，避免连接到错误数据。"
    }
}

$env:TCM_ILLUSTRATION_DATA_DIR = $dataDir
$env:TCM_ILLUSTRATION_DATASET_ID = $datasetId
$env:TCM_ILLUSTRATION_DATA_LABEL = $datasetLabel
$env:TCM_ILLUSTRATION_READ_ONLY = "0"

$startArguments = @{
    FilePath = "python"
    ArgumentList = "demo\bridge.py"
    WorkingDirectory = $root
    WindowStyle = "Hidden"
    PassThru = $true
}
$bridge = Start-Process @startArguments

$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    $status = Get-WorkbenchStatus
} until ($status -or (Get-Date) -gt $deadline)

if (-not $status) {
    if (-not $bridge.HasExited) { Stop-Process -Id $bridge.Id -Force }
    throw "标注系统启动超时。"
}
if ($status.data_source.id -ne $datasetId -or
    $status.data_source.path -ne $dataDir -or
    $status.data_source.book_count -ne $expectedBookCount -or
    $status.data_source.read_only -ne $false) {
    if (-not $bridge.HasExited) { Stop-Process -Id $bridge.Id -Force }
    throw (
        "数据源检查失败，已停止服务。预期：id=$datasetId，目录=$dataDir，册数=$expectedBookCount，可写；" +
        "实际：id=$($status.data_source.id)，目录=$($status.data_source.path)，" +
        "册数=$($status.data_source.book_count)，只读=$($status.data_source.read_only)。"
    )
}

Open-Workbench
Write-Host "完整书库已进入新版重标模式：$expectedBookCount 册，数据目录 $dataDir。"
