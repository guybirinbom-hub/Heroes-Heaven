# Build a RELEASE arm64 APK for Heroes Heaven on Windows — optimized Rust, minified, signed with the
# release keystore at signing/heroes-heaven-release.keystore (see signing/keystore.properties).
#
# The release app id is com.wandererscodex.app (no ".debug" suffix), so it installs SIDE-BY-SIDE with
# the debug build — publish this one; keep developing/testing on the debug one.
#
# Uses the same two Windows workarounds as the debug script (scripts/build-android.ps1):
#   1. Spaces in the project path break the NDK linker -> space-free CARGO_TARGET_DIR.
#   2. Windows forbids symlinks without Developer Mode -> let Tauri compile the .so (its symlink step
#      fails; expected), then copy it into jniLibs and assemble with Gradle, skipping the rust task.
#
# NOTE: debug and release share src/main/jniLibs — each script copies ITS OWN .so right before
# assembling, so always run the matching script rather than gradlew directly.
#
# Usage:  npm run android:release

$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path (Join-Path $proj 'signing\keystore.properties'))) {
  throw "signing/keystore.properties not found - the release APK would be unsigned. Create the keystore first."
}

# --- Toolchain env (fall back to the known install locations if not already set) ---
if (-not $env:JAVA_HOME)    { $env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $env:NDK_HOME) {
  $env:NDK_HOME = (Get-ChildItem (Join-Path $env:ANDROID_HOME 'ndk') -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
}
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:CARGO_TARGET_DIR = 'C:\hhbuild'   # space-free: the NDK linker can't handle spaces in paths

Write-Host "JAVA_HOME = $env:JAVA_HOME"
Write-Host "NDK_HOME = $env:NDK_HOME"
Write-Host "CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR"

# --- Build the optimized .so via Tauri (also runs the frontend build). The symlink-to-jniLibs step
#     fails on non-Developer-Mode Windows; we ignore that and finish with Gradle below. ---
Set-Location $proj
Write-Host "`n==> tauri android build [RELEASE] (frontend + optimized Rust .so)..."
npx tauri android build --apk --target aarch64

$so = Join-Path $env:CARGO_TARGET_DIR 'aarch64-linux-android\release\libapp_lib.so'
if (-not (Test-Path $so)) { throw "Release Rust library was not produced at $so - check the cargo/link output above." }

# --- Copy the .so into jniLibs and assemble the signed APK (rust task excluded so Gradle won't re-symlink) ---
$jni = Join-Path $proj 'src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a'
New-Item -ItemType Directory -Force -Path $jni | Out-Null
Copy-Item $so (Join-Path $jni 'libapp_lib.so') -Force
Write-Host "`n==> Assembling signed release APK via Gradle..."
Set-Location (Join-Path $proj 'src-tauri\gen\android')
.\gradlew.bat assembleArm64Release -x rustBuildArm64Release --console=plain
if ($LASTEXITCODE -ne 0) { throw "Gradle assemble failed." }

$apk = Join-Path $proj 'src-tauri\gen\android\app\build\outputs\apk\arm64\release\app-arm64-release.apk'
if (Test-Path $apk) {
  Write-Host "`n==> DONE. Signed release APK:"
  Write-Host "    $apk"
} else {
  throw "Gradle reported success but the APK is missing at $apk"
}
