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

    # --- Quét Shorts (hình ảnh) ---
    Write-Host "==> [1/2] Scan Shorts..." -ForegroundColor Cyan
    node --env-file-if-exists=.env src/scan.js
    if ($LASTEXITCODE -ne 0) {
        throw "Scan Shorts thất bại (exit $LASTEXITCODE). Không commit gì cả."
    }

    # --- Quét long-form (truyện audio tiếng Việt) ---
    # Quota dùng chung một pot 10k/ngày, guard trong quota.js tự chặn nếu cạn.
    Write-Host "==> [2/2] Scan long-form..." -ForegroundColor Cyan
    node --env-file-if-exists=.env src/scan.js --mode=longform
    if ($LASTEXITCODE -ne 0) {
        throw "Scan long-form thất bại (exit $LASTEXITCODE). Không commit gì cả."
    }

    # --- Chỉ commit khi data/ thực sự thay đổi ---
    $changed = git status --porcelain -- data
    if ([string]::IsNullOrWhiteSpace($changed)) {
        Write-Host "==> Không có bản ghi mới. Xong." -ForegroundColor Yellow
        return
    }

    # --- Gộp số liệu của cả hai chế độ vào commit message ---
    $day = (Get-Date).ToString('yyyy-MM-dd')
    $parts = @()
    foreach ($item in @(
            @{ File = 'data/raw-last-run.json';      Label = 'shorts' },
            @{ File = 'data/longform-last-run.json'; Label = 'longform' })) {
        if (Test-Path $item.File) {
            $run = Get-Content $item.File -Raw | ConvertFrom-Json
            $parts += "$($item.Label) +$($run.newRecords)/$($run.totalRecords)"
            $day = $run.date
        }
    }
    $msg = if ($parts.Count) { "data: $day | " + ($parts -join ' | ') } else { "data: $day | cap nhat local" }

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
