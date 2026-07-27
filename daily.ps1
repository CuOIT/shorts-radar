# daily.ps1 — chạy scanner 1 lần, rồi commit + push data nếu có bản ghi mới.
# Thay cho GitHub Actions khi tài khoản đang bị khoá billing.
#
# Cách dùng:  ở thư mục repo, chạy:  .\daily.ps1
# Không cần sửa PATH thủ công — script tự lo.

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

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
    exit 0
}

# --- Lấy số liệu cho commit message từ last-run.json ---
$day   = (Get-Date).ToString('yyyy-MM-dd')
$msg   = "data: $day | cap nhat local"
if (Test-Path 'data/last-run.json') {
    $run   = Get-Content 'data/last-run.json' -Raw | ConvertFrom-Json
    $msg   = "data: $($run.date) | $($run.newRecords) new records ($($run.totalRecords) total)"
}

git add data
git commit -m $msg
if ($LASTEXITCODE -ne 0) { throw "git commit thất bại." }

Write-Host "==> Đang push lên GitHub..." -ForegroundColor Cyan
git push origin HEAD
if ($LASTEXITCODE -ne 0) {
    Write-Host "!! Push thất bại (mạng/đăng nhập). Commit đã lưu ở local, push lại sau bằng: git push" -ForegroundColor Red
    exit 1
}

Write-Host "==> Xong: $msg" -ForegroundColor Green
