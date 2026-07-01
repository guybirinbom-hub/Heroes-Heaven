# Build a debug arm64 APK for Heroes Heaven on Windows.
#
# Works around two Windows-specific issues so a plain `tauri android build` doesn't have to:
#   1. The project path contains spaces ("trying ai 2", "pf2e codex"), which the Android NDK's
#      clang.cmd linker wrapper can't handle -> we redirect the Rust output to a space-free
#      CARGO_TARGET_DIR so none of the linker's paths contain spaces.
#   2. Tauri symlinks the compiled .so into jniLibs, and Windows forbids creating symlinks without
#      Developer Mode -> we let Tauri build the .so (the symlink step may fail, which is fine),
#      then copy the .so into jniLibs ourselves and assemble the APK with Gradle directly, excluding
#      the rust task so it doesn't try to symlink again.
#
# If you enable Windows Developer Mode, step 2's workaround becomes unnecessary (the symlink
# succeeds) but this script still works unchanged.
#
# Usage:  npm run android

$ErrorActionPreference = 'Stop'
$proj = Split-Path -Parent $PSScriptRoot

# --- Toolchain env (fall back to the known install locations if not already set) ---
if (-not $env:JAVA_HOME)    { $env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.19.10-hotspot' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not $env:NDK_HOME) {
  $env:NDK_HOME = (Get-ChildItem (Join-Path $env:ANDROID_HOME 'ndk') -Directory | Sort-Object Name -Descending | Select-Object -First 1).FullName
}
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:CARGO_TARGET_DIR = 'C:\hhbuild'   # space-free: the NDK linker can't handle spaces in paths

Write-Host "JAVA_HOME = $env:JAVA_HOME"
Write-Host "ANDROID_HOME = $env:ANDROID_HOME"
Write-Host "NDK_HOME = $env:NDK_HOME"
Write-Host "CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR"

# --- Build the .so via Tauri (also runs the frontend build first). The final symlink-to-jniLibs
#     step fails on non-Developer-Mode Windows; we ignore that and finish with Gradle below. ---
Set-Location $proj
Write-Host "`n==> tauri android build (compiling frontend + Rust .so)..."
npx tauri android build --apk --debug --target aarch64

$so = Join-Path $env:CARGO_TARGET_DIR 'aarch64-linux-android\debug\libapp_lib.so'
if (-not (Test-Path $so)) { throw "Rust library was not produced at $so - check the cargo/link output above." }

# --- Copy the .so into jniLibs and assemble the APK (rust task excluded so Gradle won't re-symlink) ---
$jni = Join-Path $proj 'src-tauri\gen\android\app\src\main\jniLibs\arm64-v8a'
New-Item -ItemType Directory -Force -Path $jni | Out-Null
Copy-Item $so (Join-Path $jni 'libapp_lib.so') -Force
Write-Host "`n==> Assembling APK via Gradle..."
Set-Location (Join-Path $proj 'src-tauri\gen\android')
.\gradlew.bat assembleArm64Debug -x rustBuildArm64Debug --console=plain
if ($LASTEXITCODE -ne 0) { throw "Gradle assemble failed." }

$apk = Join-Path $proj 'src-tauri\gen\android\app\build\outputs\apk\arm64\debug\app-arm64-debug.apk'
if (Test-Path $apk) {
  Write-Host "`n==> DONE. APK ready:"
  Write-Host "    $apk"
} else {
  throw "Gradle reported success but the APK is missing at $apk"
}
