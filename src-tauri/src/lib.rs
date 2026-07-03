/// Ask Android to uninstall this app: fire an ACTION_DELETE intent for our own package, which
/// opens the system "uninstall this app?" dialog. Uninstalling your OWN package this way needs no
/// special permission — Android itself asks the user to confirm. Must run on the Android main
/// thread with a JNI env + the activity (provided by the webview's JNI handle, see below).
/// Any JNI failure is returned as an Err string, with the pending Java exception cleared first
/// (leaving one pending would abort the VM on the next JNI call).
#[cfg(target_os = "android")]
fn request_android_uninstall(
  env: &mut jni::JNIEnv,
  activity: &jni::objects::JObject,
) -> Result<(), String> {
  use jni::objects::JString;

  macro_rules! jtry {
    ($expr:expr) => {
      match $expr {
        Ok(v) => v,
        Err(e) => {
          if env.exception_check().unwrap_or(false) {
            let _ = env.exception_clear();
          }
          return Err(e.to_string());
        }
      }
    };
  }

  // Uri.parse("package:" + activity.getPackageName())
  let pkg = jtry!(jtry!(env.call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])).l());
  let pkg: String = jtry!(env.get_string(&JString::from(pkg))).into();
  let uri_str = jtry!(env.new_string(format!("package:{pkg}")));
  let uri = jtry!(jtry!(env.call_static_method(
    "android/net/Uri",
    "parse",
    "(Ljava/lang/String;)Landroid/net/Uri;",
    &[(&uri_str).into()],
  ))
  .l());

  // new Intent("android.intent.action.DELETE", uri)
  let action = jtry!(env.new_string("android.intent.action.DELETE"));
  let intent = jtry!(env.new_object(
    "android/content/Intent",
    "(Ljava/lang/String;Landroid/net/Uri;)V",
    &[(&action).into(), (&uri).into()],
  ));

  // activity.startActivity(intent) — shows the system uninstall confirmation over the app.
  jtry!(env.call_method(
    activity,
    "startActivity",
    "(Landroid/content/Intent;)V",
    &[(&intent).into()],
  ));
  Ok(())
}

/// Remove the installed app. Per platform:
///   - Windows: launch the OS uninstaller, then exit. The .exe/MSI build places `uninstall.exe`
///     next to the app, and Tauri's NSIS uninstaller self-copies to a temp dir so it can remove
///     the install directory after this process exits. Errors when no uninstaller is found
///     (e.g. a portable or dev run) so the UI can fall back to manual removal.
///   - Android: open the system uninstall dialog for our own package (ACTION_DELETE intent);
///     Android asks the user to confirm and then removes the app. The app stays running behind
///     the dialog (the system kills it during the actual uninstall).
/// Declared async so it runs on the async runtime, NOT the main thread — the Android path blocks
/// waiting for a result from a closure dispatched TO the main thread, which would deadlock from a
/// sync (main-thread) command.
#[tauri::command]
async fn uninstall_app(app: tauri::AppHandle) -> Result<(), String> {
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
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    // This Tauri version (tao 0.35 / wry 0.55) no longer publishes the `ndk-context` globals, so
    // the supported way at raw JNI is through the webview's JNI handle, which runs a closure on
    // the Android main thread with the env + activity.
    let webview = app
      .get_webview_window("main")
      .ok_or_else(|| "no app window found".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    webview
      .with_webview(move |pw| {
        pw.jni_handle().exec(move |env, activity, _webview| {
          let _ = tx.send(request_android_uninstall(env, activity));
        });
      })
      .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(10))
      .map_err(|_| "Android did not respond to the uninstall request.".to_string())?
  }
  #[cfg(not(any(target_os = "windows", target_os = "android")))]
  {
    let _ = app;
    Err("One-click uninstall is only available on the Windows and Android builds.".to_string())
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
