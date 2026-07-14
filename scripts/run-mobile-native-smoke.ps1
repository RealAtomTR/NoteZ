param(
  [string]$Avd = 'Medium_Phone',
  [switch]$SkipBuild,
  [switch]$KeepEmulator
)

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $sdkRoot 'platform-tools\adb.exe'
$emulator = Join-Path $sdkRoot 'emulator\emulator.exe'
$apk = Join-Path $root 'android\app\build\outputs\apk\debug\app-debug.apk'
$appId = 'com.notez.app'
$cdpPort = 9222
$startedEmulator = $false
$serial = $null

function Assert-LastExitCode([string]$message) {
  if ($LASTEXITCODE -ne 0) { throw "$message (exit $LASTEXITCODE)" }
}

function Find-EmulatorSerial {
  $line = & $adb devices | Select-String -Pattern '^emulator-\d+\s+device$' | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line.Line -split '\s+')[0]
}

function Remove-CdpForward {
  if (-not $serial) { return }
  $forwards = @(& $adb -s $serial forward --list)
  $hasForward = $forwards | Where-Object { $_ -match "\btcp:$cdpPort\b" } | Select-Object -First 1
  if ($hasForward) {
    & $adb -s $serial forward --remove "tcp:$cdpPort"
    Assert-LastExitCode 'WebView debug port yönlendirmesi kaldırılamadı'
  }
}

if (-not (Test-Path -LiteralPath $adb)) { throw "ADB bulunamadı: $adb" }
if (-not (Test-Path -LiteralPath $emulator)) { throw "Android emulator bulunamadı: $emulator" }

try {
  if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build-mobile-android.ps1')
    Assert-LastExitCode 'Android debug build başarısız'
  }

  if (-not (Test-Path -LiteralPath $apk)) { throw "Debug APK bulunamadı: $apk" }

  $serial = Find-EmulatorSerial
  if (-not $serial) {
    $availableAvds = @(& $emulator -list-avds)
    if ($availableAvds -notcontains $Avd) { throw "AVD bulunamadı: $Avd" }
    Start-Process -FilePath $emulator -ArgumentList @('-avd', $Avd, '-no-snapshot-load', '-no-snapshot-save', '-no-boot-anim') -WindowStyle Hidden
    $startedEmulator = $true

    for ($attempt = 0; $attempt -lt 60 -and -not $serial; $attempt += 1) {
      Start-Sleep -Seconds 1
      $serial = Find-EmulatorSerial
    }
    if (-not $serial) { throw 'Emulator ADB bağlantısı zaman aşımına uğradı.' }
  }

  $bootCompleted = ''
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    $bootCompleted = (& $adb -s $serial shell getprop sys.boot_completed 2>$null).Trim()
    if ($bootCompleted -eq '1') { break }
    Start-Sleep -Seconds 1
  }
  if ($bootCompleted -ne '1') { throw 'Emulator açılışı zaman aşımına uğradı.' }

  Write-Output "Native smoke emulator: $serial"
  Write-Output "Native smoke APK: $apk"

  & $adb -s $serial install -r $apk
  Assert-LastExitCode 'Güncel APK kurulamadı'
  & $adb -s $serial shell am force-stop $appId
  Assert-LastExitCode 'Uygulama durdurulamadı'
  & $adb -s $serial shell pm clear $appId
  Assert-LastExitCode 'Uygulama verisi temizlenemedi'
  & $adb -s $serial shell monkey -p $appId -c android.intent.category.LAUNCHER 1 | Out-Null
  Assert-LastExitCode 'Uygulama başlatılamadı'

  $socket = $null
  for ($attempt = 0; $attempt -lt 50 -and -not $socket; $attempt += 1) {
    Start-Sleep -Milliseconds 200
    $unixSockets = (& $adb -s $serial shell cat /proc/net/unix) -join "`n"
    $matches = [regex]::Matches($unixSockets, 'webview_devtools_remote_\d+')
    if ($matches.Count -gt 0) { $socket = $matches[$matches.Count - 1].Value }
  }
  if (-not $socket) { throw 'NoteZ WebView debug socket bulunamadı.' }

  Remove-CdpForward
  & $adb -s $serial forward "tcp:$cdpPort" "localabstract:$socket"
  Assert-LastExitCode 'WebView debug port yönlendirilemedi'

  $env:NOTEZ_CDP_PORT = [string]$cdpPort
  & node (Join-Path $PSScriptRoot 'mobile-native-smoke.js')
  Assert-LastExitCode 'Native WebView smoke başarısız'
} finally {
  if ($serial) {
    Remove-CdpForward
    if ($startedEmulator -and -not $KeepEmulator) {
      & $adb -s $serial emu kill 2>$null
    }
  }
}
