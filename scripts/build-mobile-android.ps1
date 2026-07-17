$ErrorActionPreference = 'Stop'

$sdkRoot = if ($env:ANDROID_SDK_ROOT) {
  $env:ANDROID_SDK_ROOT
} elseif ($env:ANDROID_HOME) {
  $env:ANDROID_HOME
} else {
  Join-Path $env:LOCALAPPDATA 'Android\Sdk'
}

if (-not (Test-Path -LiteralPath (Join-Path $sdkRoot 'platform-tools\adb.exe'))) {
  throw "Android SDK bulunamadı: $sdkRoot"
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
Write-Output "Android SDK: $sdkRoot"

npm run mobile:sync
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$jdkCandidates = @(
  $env:JAVA_HOME,
  'C:\Program Files\Java\jdk-21',
  'C:\Program Files\Java\jdk-24',
  'C:\Program Files\Android\Android Studio\jbr'
) | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'bin\java.exe')) }

$selectedJdk = $null
foreach ($candidate in $jdkCandidates) {
  $releaseFile = Join-Path $candidate 'release'
  $releaseInfo = if (Test-Path -LiteralPath $releaseFile) { Get-Content -Raw -LiteralPath $releaseFile } else { '' }
  if ($releaseInfo -match 'JAVA_VERSION="(\d+)') {
    $major = [int]$Matches[1]
    if ($major -ge 17 -and $major -le 24) {
      $selectedJdk = $candidate
      break
    }
  }
}

if (-not $selectedJdk) {
  throw 'Android build için Java 17-24 aralığında uyumlu bir JDK bulunamadı.'
}

$env:JAVA_HOME = $selectedJdk
$env:Path = "$(Join-Path $selectedJdk 'bin');$env:Path"
Write-Output "Android build JDK: $selectedJdk"

& (Join-Path $PSScriptRoot '..\android\gradlew.bat') -p (Join-Path $PSScriptRoot '..\android') assembleDebug
exit $LASTEXITCODE
