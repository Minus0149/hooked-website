# Daily, after the chart pull (10:53 IST) and curation (11:23 IST): find the hook and the
# sound of every song the pull added, then rebuild the catalogue so the app gets them.
# Without this, new chart songs played their whole preview from 0:00 (31 Oct: 978 waiting).
# Run by the Windows task "hookedcue analyse new songs" (daily 11:47 IST). Log: .tmp\nightly-analyze.log
# The analyzer key is read from Convex prod each run and never written to disk.
$ErrorActionPreference = "Continue"
$web = Split-Path $PSScriptRoot -Parent
Set-Location $web
$log = Join-Path $web ".tmp\nightly-analyze.log"
New-Item -ItemType Directory -Force (Join-Path $web ".tmp") | Out-Null
function Log($m) { "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $m | Out-File -Append -Encoding utf8 $log }

$base = "https://shocking-goldfinch-745.convex.site"
$env:HOOK_ANALYZE_KEY = (& npx.cmd convex env get HOOK_ANALYZE_KEY --prod 2>$null | Out-String).Trim()
if (-not $env:HOOK_ANALYZE_KEY) { Log "STOP: no HOOK_ANALYZE_KEY (convex CLI not signed in?)"; exit 1 }

# 1. hooks (its own pending list, 200 a page inside the script)
$py = Join-Path $web "..\.venv-hooks\Scripts\python.exe"
$hooks = & $py scripts\analyze-hooks-v3.py --base $base --limit 3000 2>&1 | Select-Object -Last 2
Log ("hooks: " + ($hooks -join " | "))

# 2. sound, 500 a round until nothing is left
for ($i = 0; $i -lt 10; $i++) {
  $out = & node scripts\analyze-sound.mjs --base $base --limit 500 2>&1 | Where-Object { $_ -notmatch "ExperimentalWarning|trace-warnings" }
  $line = ($out | Select-String "to hear|stored" | ForEach-Object { $_.Line }) -join " | "
  Log ("sound: " + $line)
  if ($line -match "^0 track") { break }
  if ($out -match "pending request failed") { break }
}

# 3. rebuild the catalogue the app downloads
$ref = & npx.cmd convex run --prod catalog:refresh "{}" 2>&1 | Select-Object -Last 1
Log ("catalog refresh: " + $ref)
$env:HOOK_ANALYZE_KEY = $null
