# start_teaching_agent.ps1
# Local dev launcher for the teaching agent.
# Reads LLM config from .env.local (git-ignored), then starts frontend + API.
# Run:  powershell -ExecutionPolicy Bypass -File .\start_teaching_agent.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# ---- 1. Load env vars from .env.local (KEY=VALUE per line) ----
$envFile = Join-Path $PSScriptRoot ".env.local"
if (Test-Path $envFile) {
    Get-Content $envFile -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $parts = $line -split "=", 2
        if ($parts.Count -eq 2) {
            $name = $parts[0].Trim()
            $value = $parts[1].Trim()
            if ($name -and $value) {
                [Environment]::SetEnvironmentVariable($name, $value, "Process")
            }
        }
    }
    Write-Host "[env] loaded $envFile" -ForegroundColor Cyan
} else {
    Write-Host "[warn] .env.local not found, falling back to MockModel." -ForegroundColor Yellow
}

# ---- 2. Show which model will be used (key is never printed) ----
if ($env:CW_AGENT_LLM_KEY -or $env:OPENAI_API_KEY) {
    $modelName = if ($env:CW_AGENT_LLM_MODEL) { $env:CW_AGENT_LLM_MODEL } else { "default" }
    Write-Host "[env] provider = $($env:CW_AGENT_LLM_PROVIDER)" -ForegroundColor Cyan
    Write-Host "[env] model    = $modelName" -ForegroundColor Cyan
    Write-Host "[env] apiKey   = ****** (loaded, hidden)" -ForegroundColor Cyan
} else {
    Write-Host "[env] no API key configured, MockModel will be used." -ForegroundColor Yellow
}

# ---- 3. Check Node.js / npm ----
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[error] Node.js not found. Install Node.js 18+ from https://nodejs.org/" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "[error] npm not found. Please check your Node.js installation." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ---- 4. Install dependencies on first run ----
if (-not (Test-Path (Join-Path $PSScriptRoot "node_modules"))) {
    Write-Host "[setup] node_modules not found, running npm install..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[error] npm install failed." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ---- 5. Start ----
if ($env:TEACHING_AGENT_DRY_RUN) {
    Write-Host "[dry-run] env loaded, skipping npm run." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Starting teaching agent..." -ForegroundColor Green
Write-Host "  frontend: http://localhost:5174/" -ForegroundColor Green
Write-Host "  api     : http://localhost:4317/" -ForegroundColor Green
Write-Host ""
npm run teaching-agent:dev
