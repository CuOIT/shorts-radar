# daily.ps1 — chạy scanner 1 lần, rồi commit + push data nếu có bản ghi mới.
# Thay cho GitHub Actions khi tài khoản đang bị khoá billing.
#
# Chạy tay:            cd $env:USERPROFILE\WebTool ; .\daily.ps1
# Chạy tự động 10am:   đã cài qua Windows Task Scheduler (task "shorts-radar daily scan")
#
# Mỗi lần chạy ghi log vào daily.log (đã gitignore) để xem lại khi chạy nền.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

# Ghi toàn bộ output ra log; giữ lại 500 dòng gần nhất cho gọn.
$logFile = Join-Path $PSScriptRoot 'daily.log'
Start-Transcript -Path $logFile -Append | Out-Null

try {
    Write-Host "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') =====" -ForegroundColor Cyan

    # --- Node không nằm trên PATH ở máy này; nạp vào cho phiên hiện tại ---
    $nodeDir = 'C:\nvm\v22.16.0'
    if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
        throw "Không thấy node ở $nodeDir. Sửa lại biến `$nodeDir trong daily.ps1."
    }
    $env:Path = "$nodeDir;$env:Path"

    # --- .env phải tồn tại và chứa key thật ---
    if (-not (Test-Path '.env')) {
        throw "Thiếu file .env. Tạo nó với dòng: YT_API_KEY=<key-cua-ban>"
    }

    Write-Host "==> Đang scan..." -ForegroundColor Cyan
    npm run scan
    if ($LASTEXITCODE -ne 0) {
        throw "Scan thất bại (exit $LASTEXITCODE). Không commit gì cả."
    }

    # --- Chỉ commit khi data/ thực sự thay đổi ---
    $changed = git status --porcelain -- data
    if ([string]::IsNullOrWhiteSpace($changed)) {
        Write-Host "==> Không có bản ghi mới. Xong." -ForegroundColor Yellow
        return
    }

    # --- Lấy số liệu cho commit message từ last-run.json ---
    $day = (Get-Date).ToString('yyyy-MM-dd')
    $msg = "data: $day | cap nhat local"
    if (Test-Path 'data/last-run.json') {
        $run = Get-Content 'data/last-run.json' -Raw | ConvertFrom-Json
        $msg = "data: $($run.date) | $($run.newRecords) new records ($($run.totalRecords) total)"
    }

    git add data
    git commit -m $msg
    if ($LASTEXITCODE -ne 0) { throw "git commit thất bại." }

    Write-Host "==> Đang push lên GitHub..." -ForegroundColor Cyan
    git push origin HEAD
    if ($LASTEXITCODE -ne 0) {
        Write-Host "!! Push thất bại (mạng/đăng nhập). Commit đã lưu ở local, push lại sau bằng: git push" -ForegroundColor Red
        return
    }

    Write-Host "==> Xong: $msg" -ForegroundColor Green
}
catch {
    Write-Host "!! LỖI: $($_.Exception.Message)" -ForegroundColor Red
    throw
}
finally {
    Stop-Transcript | Out-Null
}
