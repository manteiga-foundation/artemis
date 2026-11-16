# Artemis, in one command, on Windows 10 or 11 (x64 or ARM64), in PowerShell:
#
#   irm https://artemis.n30.ai/install.ps1 | iex
#
# What it does, and nothing else:
#   1. Bun: uses the one on your PATH (or in ~\.bun), or installs it with Bun's own installer.
#   2. The Microsoft Visual C++ Runtime, if Windows does not have it yet (Bun's native modules, and
#      so Artemis, need it): it asks first, then installs Microsoft's own package, which shows
#      Windows' administrator prompt once.
#   3. Artemis: downloads the latest release into ~\.artemis\app (a staged copy, swapped in only
#      once it is complete, so a failed download or install leaves the version you had).
#   4. Its dependencies: `bun install` (Electron included) and Playwright's ffmpeg (the session
#      videos need it).
#   5. The `artemis` command in ~\.artemis\bin, and that folder on your user PATH.
#
# Your profile (the reviewed sites' logins) is ~\.artemis\profile and the recorded sessions are
# ~\.artemis\sessions; an update (`artemis update`, or this command again) never touches them.
# To remove Artemis: delete ~\.artemis and take ~\.artemis\bin off your user PATH.
#
# Environment: ARTEMIS_VERSION (latest, the default: the newest release; a tag such as v0.4.0; or
# main, the development branch), ARTEMIS_VCREDIST (yes or no: answers step 2 without asking),
# ARTEMIS_SOURCE (a tarball URL instead of GitHub's), ARTEMIS_BUN_INSTALLER (instead of
# https://bun.sh/install.ps1). A version goes before the command:
#   $env:ARTEMIS_VERSION = 'main'; irm https://artemis.n30.ai/install.ps1 | iex
#
# Read it before you run it: irm https://artemis.n30.ai/install.ps1 -OutFile install.ps1; notepad install.ps1

& {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'
  $Repo = 'manteiga-foundation/artemis'

  function Step([string]$text) {
    if ($env:NO_COLOR) { Write-Host "> $text" } else { Write-Host '> ' -ForegroundColor Yellow -NoNewline; Write-Host $text }
  }
  function Fail([string]$text) { throw "Artemis: $text" }

  $home_ = Join-Path $env:USERPROFILE '.artemis'
  $bin = Join-Path $home_ 'bin'
  $version = if ($env:ARTEMIS_VERSION) { $env:ARTEMIS_VERSION } else { 'latest' }
  $github = if ($env:ARTEMIS_GITHUB) { $env:ARTEMIS_GITHUB } else { 'https://github.com' }
  $source = $env:ARTEMIS_SOURCE
  $installer = 'https://artemis.n30.ai/install.ps1'
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path $curl) -or -not (Test-Path $tar)) { Fail 'curl.exe and tar.exe are needed (Windows 10 1803 or later has both)' }

  if (-not $source -and $version -eq 'latest') {
    # GitHub answers releases/latest with a redirect to the newest release's tag page.
    $landed = & $curl -fsSL -o NUL -w '%{url_effective}' "$github/$Repo/releases/latest" 2>$null
    if ($landed -match '/releases/tag/(.+)$') { $version = $Matches[1] }
    else { Fail "the latest release could not be found ($github/$Repo/releases/latest); to install anyway, pick one: `$env:ARTEMIS_VERSION = 'main'; irm $installer | iex" }
  }
  if (-not $source) {
    $source = if ($version -eq 'main') { "$github/$Repo/archive/refs/heads/main.tar.gz" } else { "$github/$Repo/archive/refs/tags/$version.tar.gz" }
  }

  New-Item -ItemType Directory -Force -Path $home_ | Out-Null
  # Tools' own output goes to a log, shown only if a step fails.
  $log = Join-Path $home_ 'install.log'
  Set-Content -Path $log -Value '' -Encoding utf8
  # Runs a program quietly in `$dir`, its output into the log; on failure prints the log and stops.
  function Quiet([string]$what, [string]$dir, [string]$exe, [string[]]$arguments, [scriptblock]$cleanup) {
    $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $dir -NoNewWindow -Wait -PassThru `
      -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err"
    Get-Content "$log.out", "$log.err" -ErrorAction SilentlyContinue | Add-Content -Path $log -Encoding utf8
    Remove-Item "$log.out", "$log.err" -ErrorAction SilentlyContinue
    if ($p.ExitCode -ne 0) {
      Get-Content $log | ForEach-Object { [Console]::Error.WriteLine($_) }
      if ($cleanup) { & $cleanup }
      Fail "$what (the full output is above, and in $log)"
    }
  }

  # 1. Bun
  $bun = (Get-Command bun -ErrorAction SilentlyContinue).Source
  if (-not $bun -and (Test-Path "$env:USERPROFILE\.bun\bin\bun.exe")) { $bun = "$env:USERPROFILE\.bun\bin\bun.exe" }
  if (-not $bun) {
    Step 'Installing Bun (bun.sh)'
    $bunInstaller = if ($env:ARTEMIS_BUN_INSTALLER) { $env:ARTEMIS_BUN_INSTALLER } else { 'https://bun.sh/install.ps1' }
    $script = Join-Path $home_ '.bun-install.ps1'
    & $curl -fsSL $bunInstaller -o $script
    if ($LASTEXITCODE -ne 0) { Fail "Bun's installer could not be downloaded" }
    Quiet "Bun's installer failed" $home_ 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$script`"") { Remove-Item $script -ErrorAction SilentlyContinue }
    Remove-Item $script -ErrorAction SilentlyContinue
    $bun = "$env:USERPROFILE\.bun\bin\bun.exe"
    if (-not (Test-Path $bun)) { Fail 'Bun was not found after installing it' }
  }
  $bunVersion = (& $bun --version).Trim()
  if ($bunVersion -match '^(0\.|1\.[0-3]\.)') { Fail "Bun $bunVersion is too old: Artemis needs 1.4 or newer (bun upgrade)" }
  Step "Bun $bunVersion"

  # 2. The Microsoft Visual C++ Runtime (vcruntime140.dll), which Bun's native modules load.
  $system32 = if ($env:ARTEMIS_SYSTEM32) { $env:ARTEMIS_SYSTEM32 } else { Join-Path $env:SystemRoot 'System32' }
  if (-not (Test-Path (Join-Path $system32 'vcruntime140.dll'))) {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $redist = "https://aka.ms/vs/17/release/vc_redist.$arch.exe"
    $answer = if ($env:ARTEMIS_VCREDIST) { $env:ARTEMIS_VCREDIST } else { 'ask' }
    if ($answer -eq 'ask') {
      $answer = 'no'
      if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $reply = Read-Host "Artemis needs the Microsoft Visual C++ Runtime, which this Windows does not have yet. Install it now (Microsoft's own package, one administrator prompt)? [Y/n]"
        if ($reply -eq '' -or $reply -match '^(y|yes)$') { $answer = 'yes' }
      }
    }
    if ($answer -ne 'yes') { Fail "Artemis needs the Microsoft Visual C++ Runtime: install it from $redist, then run this again" }
    Step 'Installing the Microsoft Visual C++ Runtime'
    $exe = Join-Path $home_ "vc_redist.$arch.exe"
    & $curl -fsSL $redist -o $exe
    if ($LASTEXITCODE -ne 0) { Fail "the Visual C++ Runtime could not be downloaded: $redist" }
    $p = Start-Process -FilePath $exe -ArgumentList '/install', '/quiet', '/norestart' -Verb RunAs -Wait -PassThru
    Remove-Item $exe -ErrorAction SilentlyContinue
    # 3010: installed, a restart pending; 1638: a newer one is already there.
    if (@(0, 1638, 3010) -notcontains $p.ExitCode) { Fail "the Visual C++ Runtime did not install (exit $($p.ExitCode)): install it from $redist, then run this again" }
  }

  # 3. Artemis, staged beside the installed copy
  $stage = Join-Path $home_ '.app-new'
  $work = Join-Path $home_ '.download'
  Remove-Item $stage, $work -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  Step "Downloading Artemis $version"
  & $curl -fsSL $source -o (Join-Path $work 'artemis.tar.gz')
  if ($LASTEXITCODE -ne 0) { Remove-Item $work -Recurse -Force; Fail "the download failed: $source" }
  & $tar -xzf (Join-Path $work 'artemis.tar.gz') -C $work 2>$null
  if ($LASTEXITCODE -ne 0) { Remove-Item $work -Recurse -Force; Fail "the download is not a tarball: $source" }
  $top = Get-ChildItem -Path $work -Directory | Select-Object -First 1
  if (-not $top -or -not (Test-Path (Join-Path $top.FullName 'package.json'))) { Remove-Item $work -Recurse -Force; Fail "the download has no Artemis in it: $source" }
  Move-Item $top.FullName $stage
  Remove-Item $work -Recurse -Force

  # 4. Dependencies, quietly (the log above).
  Step 'Installing dependencies'
  $dropStage = { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue }
  Quiet 'bun install failed' $stage $bun @('install', '--frozen-lockfile') $dropStage
  # Electron's binary would otherwise download on the first launch.
  Quiet 'Electron could not be downloaded' $stage $bun @('node_modules/electron/install.js') $dropStage
  Quiet "Playwright's ffmpeg could not be installed" $stage $bun @('node_modules/playwright/cli.js', 'install', 'ffmpeg') $dropStage
  Remove-Item $log -ErrorAction SilentlyContinue

  # Swap: the new copy in, the old one out.
  $app = Join-Path $home_ 'app'
  $old = Join-Path $home_ '.app-old'
  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $app) { Move-Item $app $old }
  Move-Item $stage $app
  Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Join-Path $home_ 'profile'), (Join-Path $home_ 'sessions'), $bin | Out-Null

  # 5. The command
  $cmd = @"
@echo off
rem Artemis, installed by install.ps1. ``artemis --help`` for the usage, ``artemis update`` for the latest.
if not defined ARTEMIS_HOME set "ARTEMIS_HOME=$home_"
if /i "%~1"=="update" goto update
set "BUN=$bun"
where bun >nul 2>&1 && set "BUN=bun"
set "ARTEMIS_COMMAND=artemis"
"%BUN%" run "%ARTEMIS_HOME%\app\scripts\artemis.ts" %*
exit /b %ERRORLEVEL%
:update
if not defined ARTEMIS_INSTALLER set "ARTEMIS_INSTALLER=$installer"
if /i "%ARTEMIS_INSTALLER:~0,4%"=="http" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '%ARTEMIS_INSTALLER%' | iex"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%ARTEMIS_INSTALLER%"
)
exit /b %ERRORLEVEL%
"@
  $shim = Join-Path $bin 'artemis.cmd'
  Set-Content -Path "$shim.new" -Value $cmd -Encoding ascii
  Move-Item "$shim.new" $shim -Force

  # The user PATH, once; and this window's, so `artemis` answers right away.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if ($parts -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', (@($bin) + $parts) -join ';', 'User') }
  if (@($env:Path -split ';') -notcontains $bin) { $env:Path = "$bin;$env:Path" }

  Write-Host ''
  Step "Artemis installed: $shim"
  Write-Host "  Profile   $(Join-Path $home_ 'profile')"
  Write-Host "  Sessions  $(Join-Path $home_ 'sessions')"
  Write-Host ''
  Write-Host 'Then:'
  Write-Host '  artemis example.com'
  Write-Host '  artemis --help'
}
