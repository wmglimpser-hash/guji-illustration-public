param(
  [string]$OutputDir = "showcase_publish",
  [switch]$SkipData
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$showcaseDir = Join-Path $repoRoot "showcase"
$targetDir = Join-Path $repoRoot $OutputDir
$resolvedParent = (Resolve-Path $repoRoot).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

if (-not (Test-Path -LiteralPath $showcaseDir)) {
  throw "Missing showcase directory: $showcaseDir"
}

$targetFull = [System.IO.Path]::GetFullPath($targetDir)
if (-not $targetFull.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write outside repo root: $targetFull"
}

if ($targetFull -eq $showcaseDir) {
  throw "OutputDir must not be showcase itself."
}

if (Test-Path -LiteralPath $targetFull) {
  Remove-Item -LiteralPath $targetFull -Recurse -Force
}
New-Item -ItemType Directory -Path $targetFull | Out-Null

$files = @(
  "index.html",
  "app.js",
  "style.css",
  "vercel.json"
)

foreach ($file in $files) {
  $src = Join-Path $showcaseDir $file
  if (Test-Path -LiteralPath $src) {
    Copy-Item -LiteralPath $src -Destination (Join-Path $targetFull $file) -Force
  }
}

$samplesDir = Join-Path $showcaseDir "samples"
if (Test-Path -LiteralPath $samplesDir) {
  Copy-Item -LiteralPath $samplesDir -Destination (Join-Path $targetFull "samples") -Recurse -Force
}

$dataDir = Join-Path $showcaseDir "data"
if (-not $SkipData) {
  if (-not (Test-Path -LiteralPath $dataDir)) {
    throw "Missing showcase/data. Export frozen data before publishing."
  }
  Copy-Item -LiteralPath $dataDir -Destination (Join-Path $targetFull "data") -Recurse -Force
  Get-ChildItem -LiteralPath (Join-Path $targetFull "data") -Filter "*.before_*.json" -File -ErrorAction SilentlyContinue |
    Remove-Item -Force

  $publicManifest = Join-Path $targetFull "data\export_manifest.json"
  if (Test-Path -LiteralPath $publicManifest) {
    $manifest = Get-Content -LiteralPath $publicManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.PSObject.Properties.Name -contains "warnings") {
      $manifest.warnings = @($manifest.warnings | ForEach-Object {
        if ($_ -match '127\.0\.0\.1|api/page-image|base64') {
          'book_1780643127071_p081: skipped non-embedded image record for public export.'
        } else {
          $_
        }
      })
    }
    $manifestJson = ($manifest | ConvertTo-Json -Depth 8) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($publicManifest, $manifestJson, $utf8NoBom)
  }
}

$fileStats = Get-ChildItem -LiteralPath $targetFull -Recurse -File | Measure-Object -Property Length -Sum
$dataManifest = Join-Path $targetFull "data\export_manifest.json"
$manifestText = ""
if (Test-Path -LiteralPath $dataManifest) {
  $manifestText = Get-Content -LiteralPath $dataManifest -Raw
}

$summary = [ordered]@{
  generated_at = (Get-Date).ToString("s")
  file_count = $fileStats.Count
  bytes = [int64]$fileStats.Sum
  includes_data = -not $SkipData
  data_manifest_present = (Test-Path -LiteralPath $dataManifest)
}

$summaryJson = ($summary | ConvertTo-Json -Depth 4) + [Environment]::NewLine
[System.IO.File]::WriteAllText((Join-Path $targetFull "publish_summary.json"), $summaryJson, $utf8NoBom)

Write-Host "Prepared showcase publish package:"
Write-Host "  Output: $targetFull"
Write-Host "  Files:  $($summary.file_count)"
Write-Host "  Bytes:  $($summary.bytes)"
Write-Host "  Data:   $($summary.includes_data)"
if ($manifestText) {
  Write-Host "  Manifest: data/export_manifest.json present"
}
