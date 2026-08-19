$ErrorActionPreference = "Continue"
$MigrationDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $MigrationDir

if (-not (Test-Path "../_config.yml") -or -not (Test-Path "../_data")) {
    Write-Error "Place migration/ inside a clone of HCAI-Lab-GT/eilab-gt.github.io."
    exit 2
}

$BasePython = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
    $BasePython = @("py", "-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $BasePython = @("python")
} else {
    Write-Error "Python 3.11+ is required."
    exit 2
}

if (-not (Test-Path ".venv")) {
    if ($BasePython.Count -eq 2) { & $BasePython[0] $BasePython[1] -m venv .venv }
    else { & $BasePython[0] -m venv .venv }
    if ($LASTEXITCODE -ne 0) { exit 2 }
}

$Python = Join-Path $MigrationDir ".venv/Scripts/python.exe"
& $Python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { exit 2 }
& $Python -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { exit 2 }

New-Item -ItemType Directory -Force -Path build | Out-Null

Write-Host "== 1/4 Source audit =="
& $Python scripts/audit_source.py --source-root ..
$AuditStatus = $LASTEXITCODE

Write-Host "== 2/4 Public WordPress discovery (GET only) =="
& $Python scripts/discover_wordpress.py
$DiscoveryStatus = $LASTEXITCODE
if ($DiscoveryStatus -ne 0) {
    Write-Host "NOTE: Public REST discovery did not complete. This is non-fatal; local generation will continue."
}

Write-Host "== 3/4 Local migration build =="
& $Python scripts/run_pipeline.py --source-root ..
$BuildStatus = $LASTEXITCODE

Write-Host "== 4/4 Tests =="
& $Python -m pytest -q
$TestStatus = $LASTEXITCODE

@"
source_audit_exit=$AuditStatus
wordpress_discovery_exit=$DiscoveryStatus
local_build_exit=$BuildStatus
tests_exit=$TestStatus
target=https://sites.gatech.edu/hcailab
"@ | Set-Content -Encoding UTF8 build/first-pass-status.txt

if ($AuditStatus -ne 0 -or $BuildStatus -ne 0 -or $TestStatus -ne 0) {
    Write-Error "First pass completed with local errors. Review build/ and fix them before any WordPress mutation."
    exit 2
}

if ($DiscoveryStatus -ne 0) {
    Write-Host "`nLocal package built successfully. Next run: make browser-discover"
} else {
    Write-Host "`nFirst pass succeeded. Review build/wordpress-capabilities.md and build/pipeline-report.json."
}
