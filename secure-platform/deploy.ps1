$ErrorActionPreference = 'Stop'

Write-Host 'HBE Secure Buyer Platform deployment' -ForegroundColor Cyan

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host '1/6 Checking Wrangler authentication...'
npx --yes wrangler@latest whoami

$dbName = 'hbe-buyer-journey-v2'
$buyerBaseUrl = 'https://buyer.hbexperts.com'
$configPath = Join-Path $root 'wrangler.toml'
$tempConfigPath = Join-Path $root '.wrangler.deploy.toml'
$config = Get-Content $configPath -Raw

Write-Host '2/6 Locating existing D1 database...'
$dbs = npx --yes wrangler@latest d1 list --json | ConvertFrom-Json
$db = $dbs | Where-Object { $_.name -eq $dbName } | Select-Object -First 1
if (-not $db -or -not $db.uuid) {
  throw "Production deployment stopped: existing D1 database '$dbName' was not found. This release will not create or substitute a production database automatically."
}

$config = [regex]::Replace($config, 'database_id\s*=\s*"[^"]+"', "database_id = `"$($db.uuid)`"")
if ($config -match 'REPLACE_[A-Z0-9_]+') {
  throw 'Deployment preflight failed: unresolved REPLACE_ placeholder remains in Wrangler configuration.'
}
if ($config -notmatch '(?m)^keep_vars\s*=\s*true\s*$') {
  throw 'Deployment preflight failed: keep_vars=true is required so live dashboard-managed Access variables are preserved.'
}
if ($config -notmatch '(?m)^main\s*=\s*"src/issue33-production-worker\.js"\s*$') {
  throw 'Deployment preflight failed: Wrangler must point to the final Issue 33 production wrapper.'
}
Set-Content -Path $tempConfigPath -Value $config -Encoding UTF8
Write-Host "Using existing D1 database $dbName ($($db.uuid))"

try {
  Write-Host '3/6 Applying additive database schema...'
  npx --yes wrangler@latest d1 execute $dbName --remote --file=schema.sql --config $tempConfigPath
  npx --yes wrangler@latest d1 execute $dbName --remote --file=schema-stage4.sql --config $tempConfigPath
  npx --yes wrangler@latest d1 execute $dbName --remote --file=schema-issue29.sql --config $tempConfigPath
  npx --yes wrangler@latest d1 execute $dbName --remote --file=schema-issue33.sql --config $tempConfigPath

  Write-Host '4/6 Running local source, Issue 29, Issue 33, and buyer-first checks...'
  node --check src/worker.js
  node --check src/ui-worker.js
  node --check src/portal-worker.js
  node --check src/access-code-worker.js
  node --check src/hbe-worker.js
  node --check src/hbe-portal-sync-worker.js
  node --check src/pilot-worker.js
  node --check src/co-buyer-consent-worker.js
  node --check src/hbe-access-worker.js
  node --check src/consultation-worker.js
  node --check src/representation-worker.js
  node --check src/mls-adapter.js
  node --check src/search-worker.js
  node --check src/journey-state-worker.js
  node --check src/value-brand-worker.js
  node --check src/journey-stages.js
  node --check src/household-state.js
  node --check src/issue29-ui.js
  node --check src/issue29-convergence-worker.js
  node --check src/issue29-production-worker.js
  node --check src/bimatrix/evaluator.js
  node --check src/bimatrix/freshness.js
  node --check src/issue33-production-worker.js
  node --test tests/issue29.test.mjs
  node --test tests/bimatrix.test.mjs
  node --test tests/issue36.test.mjs
  if (Select-String -Path src/worker.js -Pattern 'donald-kelley|localStorage|buyer_token_hash' -Quiet) {
    throw 'Security/source check failed: legacy buyer-specific or browser-local journey code detected.'
  }

  Write-Host 'Running Wrangler bundle dry-run...'
  npx --yes wrangler@latest deploy --dry-run --config $tempConfigPath

  Write-Host '5/6 Deploying Worker to buyer.hbexperts.com...'
  $oldErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $deployOutput = & npx --yes wrangler@latest deploy --config $tempConfigPath 2>&1
  $deployExitCode = $LASTEXITCODE
  $ErrorActionPreference = $oldErrorActionPreference
  $deployOutput | ForEach-Object { Write-Host $_ }
  if ($deployExitCode -ne 0) {
    throw "Wrangler deploy failed with exit code $deployExitCode."
  }

  Write-Host '6/6 Verifying custom-domain health endpoint...'
  $health = Invoke-RestMethod -Uri "$buyerBaseUrl/health" -Method Get
  if (-not $health.ok) {
    throw 'Health verification failed.'
  }
  if (-not $health.issue29 -or $health.issue29.stages -ne 17) {
    throw 'Issue 29 health verification failed: expected the 17-stage convergence layer.'
  }
  if (-not $health.issue33 -or -not $health.issue33.bimatrix -or -not $health.issue33.buyer_refresh) {
    throw 'Issue 33 health verification failed: expected BIMatrix and buyer refresh support.'
  }
  if (-not $health.issue36 -or -not $health.issue36.buyer_first_clarity -or -not $health.issue36.pre_submit_review -or -not $health.issue36.attention_architecture -or -not $health.issue36.guided_open_answers) {
    throw 'Issue 36 health verification failed: expected buyer-first clarity, review-before-send, simplified attention architecture, and guided open answers.'
  }

  Write-Host ''
  Write-Host 'LIVE' -ForegroundColor Green
  Write-Host "Buyer Journey: $buyerBaseUrl/"
  Write-Host "Buyer Portal:  $buyerBaseUrl/portal"
  Write-Host "HBE Portal:    $buyerBaseUrl/hbe"
  Write-Host "Health:        $buyerBaseUrl/health"
  Write-Host ''
  Write-Host 'Issue 29 convergence remains enabled: 17-stage journey, household story/compass, What''s Next, per-buyer privacy, and After the Keys.' -ForegroundColor Green
  Write-Host 'Issue 33 BIMatrix enabled: authenticated Possible Assistance, Last updated / Update now freshness check, canonical rules, and D1 household isolation.' -ForegroundColor Green
  Write-Host 'Issue 36 buyer-first Phase 2 enabled: Now / Why / Best next step / Time default view, full journey as expandable context, review-before-send, and guided open-ended answers with uncertainty allowed.' -ForegroundColor Green
  Write-Host 'Buyer-triggered freshness checks do not silently change canonical rules; unexpected source changes are sent to HBE review state.' -ForegroundColor Yellow
  Write-Host 'MLS adapter remains disconnected/unapproved until MLS Now approves the exact feed and encrypted credentials are configured.' -ForegroundColor Yellow
  Write-Host 'HBE Portal must remain protected by Cloudflare Access.' -ForegroundColor Yellow
  Write-Host 'Sensitive uploads remain disabled until /sensitive* has fresh email-OTP Access protection.' -ForegroundColor Yellow
}
finally {
  if (Test-Path $tempConfigPath) {
    Remove-Item $tempConfigPath -Force
  }
}
