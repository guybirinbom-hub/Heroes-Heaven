/// Launch the OS uninstaller for the installed app, then exit. Windows-only: the .exe/MSI build
/// places `uninstall.exe` next to the app, and Tauri's NSIS uninstaller self-copies to a temp dir
/// so it can remove the install directory after this process exits. Returns an error string when no
/// uninstaller is found (e.g. a portable or dev run) so the UI can fall back to manual removal.
#[tauri::command]
fn uninstall_app(app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
      .parent()
      .ok_or_else(|| "could not locate the install directory".to_string())?;
    for name in ["uninstall.exe", "Uninstall.exe"] {
      let p = dir.join(name);
      if p.exists() {
        std::process::Command::new(&p)
          .spawn()
          .map_err(|e| e.to_string())?;
        app.exit(0);
        return Ok(());
      }
    }
    Err("No uninstaller was found next to the app. Remove it from Windows Settings → Apps.".to_string())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = app;
    Err("One-click uninstall is only available on the Windows build.".to_string())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![uninstall_app])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
