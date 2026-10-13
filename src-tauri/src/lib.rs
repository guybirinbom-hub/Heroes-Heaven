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

/// The sub-folder of the FileProvider's cache root that shared exports are written to.
#[cfg(target_os = "android")]
const SHARE_DIR: &str = "shared-exports";

/// The bare file name a share may be written under: no folder part, nothing that walks out of the
/// share folder. download.ts refuses a name that looks like file content before it gets here; this is
/// the Rust side's own refusal, since the name becomes a path in the app's cache.
fn share_file_name(name: &str) -> Result<&str, String> {
  if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', '\0']) {
    return Err(format!("\"{name}\" is not a file name, so nothing was shared."));
  }
  Ok(name)
}

/// Drop shared exports older than an hour: the share sheet hands the receiving app a read grant on
/// the file, so it must outlive this call, but nothing needs it for long.
#[cfg(target_os = "android")]
fn prune_old_shares(dir: &std::path::Path) {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return;
  };
  for entry in entries.flatten() {
    let old = entry
      .metadata()
      .ok()
      .and_then(|m| m.modified().ok())
      .and_then(|t| t.elapsed().ok())
      .map_or(false, |age| age.as_secs() > 3600);
    if old {
      let _ = std::fs::remove_file(entry.path());
    }
  }
}

/// Android "Share" for an export: write `text` under the cache root the app's FileProvider serves,
/// then open the system share sheet (ACTION_SEND with a read grant) for that file. Runs on the
/// Android main thread with the activity, like request_android_uninstall.
///
/// Framework calls only, never androidx code by name: the release APK is minified by R8, which renames
/// or drops androidx methods no Kotlin code calls (FileProvider.getUriForFile is not in the v0.1.43
/// release dex), so a JNI call to it would work in the debug APK and fail in the release one. Instead
/// the provider is looked up through PackageManager (its authority, and the `<cache-path>` entry of its
/// FILE_PROVIDER_PATHS meta-data), and the content URI is built with Uri.Builder in the shape the
/// provider itself resolves: content://<authority>/<cache-path name>/<path under its root>.
#[cfg(target_os = "android")]
fn share_android_file(
  env: &mut jni::JNIEnv,
  activity: &jni::objects::JObject,
  name: &str,
  text: &str,
  mime: &str,
) -> Result<(), String> {
  use jni::objects::{JObject, JString, JValue};

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
  macro_rules! jstring {
    ($obj:expr) => {{
      let obj: JObject = $obj;
      if obj.is_null() {
        None
      } else {
        let s: String = jtry!(env.get_string(&JString::from(obj))).into();
        Some(s)
      }
    }};
  }

  // The FileProvider the manifest declares: its authority and its FILE_PROVIDER_PATHS meta-data.
  let pkg = jtry!(jtry!(env.call_method(activity, "getPackageName", "()Ljava/lang/String;", &[])).l());
  let pm = jtry!(jtry!(env.call_method(
    activity,
    "getPackageManager",
    "()Landroid/content/pm/PackageManager;",
    &[],
  ))
  .l());
  let provider_class = jtry!(env.new_string("androidx.core.content.FileProvider"));
  let component = jtry!(env.new_object(
    "android/content/ComponentName",
    "(Ljava/lang/String;Ljava/lang/String;)V",
    &[(&pkg).into(), (&provider_class).into()],
  ));
  // PackageManager.GET_META_DATA = 128
  let info = jtry!(jtry!(env.call_method(
    &pm,
    "getProviderInfo",
    "(Landroid/content/ComponentName;I)Landroid/content/pm/ProviderInfo;",
    &[(&component).into(), JValue::Int(128)],
  ))
  .l());
  let authority = jstring!(jtry!(jtry!(env.get_field(&info, "authority", "Ljava/lang/String;")).l()))
    .ok_or_else(|| "The app's file provider has no authority.".to_string())?;
  // A provider may list several authorities separated by ';' — the first one serves.
  let authority = authority.split(';').next().unwrap_or_default().to_string();
  let meta_key = jtry!(env.new_string("android.support.FILE_PROVIDER_PATHS"));
  let parser = jtry!(jtry!(env.call_method(
    &info,
    "loadXmlMetaData",
    "(Landroid/content/pm/PackageManager;Ljava/lang/String;)Landroid/content/res/XmlResourceParser;",
    &[(&pm).into(), (&meta_key).into()],
  ))
  .l());
  if parser.is_null() {
    return Err("The app's file provider lists no folders it can share.".to_string());
  }
  let attr_name = jtry!(env.new_string("name"));
  let attr_path = jtry!(env.new_string("path"));
  let no_namespace = JObject::null();
  let mut cache_entry: Option<(String, String)> = None;
  loop {
    // XmlPullParser: END_DOCUMENT = 1, START_TAG = 2
    let event = jtry!(jtry!(env.call_method(&parser, "next", "()I", &[])).i());
    if event == 1 {
      break;
    }
    if event != 2 {
      continue;
    }
    let tag = jstring!(jtry!(jtry!(env.call_method(&parser, "getName", "()Ljava/lang/String;", &[])).l()));
    if tag.as_deref() != Some("cache-path") {
      continue;
    }
    let tag_name = jstring!(jtry!(jtry!(env.call_method(
      &parser,
      "getAttributeValue",
      "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
      &[(&no_namespace).into(), (&attr_name).into()],
    ))
    .l()));
    let root_path = jstring!(jtry!(jtry!(env.call_method(
      &parser,
      "getAttributeValue",
      "(Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
      &[(&no_namespace).into(), (&attr_path).into()],
    ))
    .l()));
    if let Some(tag_name) = tag_name {
      cache_entry = Some((tag_name, root_path.unwrap_or_default()));
    }
    break;
  }
  jtry!(env.call_method(&parser, "close", "()V", &[]));
  let (tag_name, root_path) =
    cache_entry.ok_or_else(|| "The app's file provider has no cache folder to share from.".to_string())?;

  // Write the file under that root: <cacheDir>/<root path>/shared-exports/<name>.
  let cache_dir = jtry!(jtry!(env.call_method(activity, "getCacheDir", "()Ljava/io/File;", &[])).l());
  let cache_dir = jstring!(jtry!(jtry!(env.call_method(
    &cache_dir,
    "getAbsolutePath",
    "()Ljava/lang/String;",
    &[],
  ))
  .l()))
  .ok_or_else(|| "The app has no cache folder.".to_string())?;
  let dir = std::path::Path::new(&cache_dir)
    .join(root_path.trim_start_matches('/'))
    .join(SHARE_DIR);
  std::fs::create_dir_all(&dir).map_err(|e| format!("Could not prepare the file to share: {e}"))?;
  prune_old_shares(&dir);
  std::fs::write(dir.join(name), text).map_err(|e| format!("Could not write the file to share: {e}"))?;

  // content://<authority>/<cache-path name>/shared-exports/<name>, each segment encoded.
  let builder = jtry!(env.new_object("android/net/Uri$Builder", "()V", &[]));
  for (method, value) in [
    ("scheme", "content"),
    ("authority", authority.as_str()),
    ("appendPath", tag_name.as_str()),
    ("appendPath", SHARE_DIR),
    ("appendPath", name),
  ] {
    let value = jtry!(env.new_string(value));
    jtry!(env.call_method(
      &builder,
      method,
      "(Ljava/lang/String;)Landroid/net/Uri$Builder;",
      &[(&value).into()],
    ));
  }
  let uri = jtry!(jtry!(env.call_method(&builder, "build", "()Landroid/net/Uri;", &[])).l());

  // new Intent(ACTION_SEND) with the file as EXTRA_STREAM and ClipData, and a read grant on it.
  let action = jtry!(env.new_string("android.intent.action.SEND"));
  let send = jtry!(env.new_object("android/content/Intent", "(Ljava/lang/String;)V", &[(&action).into()]));
  let mime = jtry!(env.new_string(mime));
  jtry!(env.call_method(&send, "setType", "(Ljava/lang/String;)Landroid/content/Intent;", &[(&mime).into()]));
  let extra_stream = jtry!(env.new_string("android.intent.extra.STREAM"));
  jtry!(env.call_method(
    &send,
    "putExtra",
    "(Ljava/lang/String;Landroid/os/Parcelable;)Landroid/content/Intent;",
    &[(&extra_stream).into(), (&uri).into()],
  ));
  let label = jtry!(env.new_string(name));
  let extra_title = jtry!(env.new_string("android.intent.extra.TITLE"));
  jtry!(env.call_method(
    &send,
    "putExtra",
    "(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;",
    &[(&extra_title).into(), (&label).into()],
  ));
  let clip = jtry!(jtry!(env.call_static_method(
    "android/content/ClipData",
    "newRawUri",
    "(Ljava/lang/CharSequence;Landroid/net/Uri;)Landroid/content/ClipData;",
    &[(&label).into(), (&uri).into()],
  ))
  .l());
  jtry!(env.call_method(&send, "setClipData", "(Landroid/content/ClipData;)V", &[(&clip).into()]));
  // Intent.FLAG_GRANT_READ_URI_PERMISSION = 1
  jtry!(env.call_method(&send, "addFlags", "(I)Landroid/content/Intent;", &[JValue::Int(1)]));
  let chooser = jtry!(jtry!(env.call_static_method(
    "android/content/Intent",
    "createChooser",
    "(Landroid/content/Intent;Ljava/lang/CharSequence;)Landroid/content/Intent;",
    &[(&send).into(), (&label).into()],
  ))
  .l());
  jtry!(env.call_method(activity, "startActivity", "(Landroid/content/Intent;)V", &[(&chooser).into()]));
  Ok(())
}

/// An export's "Share" on the Android app (src/sheet/download.ts): the file goes to the system share
/// sheet (Discord, Drive, mail…). Async for the same reason as uninstall_app: the Android path waits
/// on a closure dispatched TO the main thread. Every other platform refuses — the web and the PC app
/// download instead, and never call this.
#[tauri::command]
async fn share_text_file(
  app: tauri::AppHandle,
  filename: String,
  text: String,
  mime: String,
) -> Result<(), String> {
  let name = share_file_name(&filename)?.to_string();
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    let webview = app
      .get_webview_window("main")
      .ok_or_else(|| "no app window found".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel();
    webview
      .with_webview(move |pw| {
        pw.jni_handle().exec(move |env, activity, _webview| {
          let _ = tx.send(share_android_file(env, activity, &name, &text, &mime));
        });
      })
      .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(20))
      .map_err(|_| "Android did not respond to the share request.".to_string())?
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (app, name, text, mime);
    Err("Sharing a file is only available on the Android app.".to_string())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
  // Android only: an export's "Save to folder" (src/sheet/download.ts) — the system save picker and
  // the write into what it picked. Not on desktop: there the dialog plugin's init script replaces
  // window.alert/confirm, and the PC app keeps its own download route. capabilities/default.json
  // grants exactly dialog:allow-save + fs:allow-write-text-file, for Android only.
  #[cfg(target_os = "android")]
  let builder = builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init());
  builder
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
    .invoke_handler(tauri::generate_handler![uninstall_app, share_text_file])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::share_file_name;

  #[test]
  fn a_shared_export_name_stays_inside_the_share_folder() {
    // MUTATION PROOF (tried 2026-10-13): drop the `name.contains([…])` clause and "../x.json" is
    // accepted — panicked at src\lib.rs: "../x.json" was accepted as a share name. (Each of the other
    // clauses guards its own row below; only the contains([…]) mutation was run.)
    assert_eq!(share_file_name("heroes-heaven-backup-2026-10-13.json"), Ok("heroes-heaven-backup-2026-10-13.json"));
    assert_eq!(share_file_name("zed-the-bold.codex.json"), Ok("zed-the-bold.codex.json"));
    for bad in ["", ".", "..", "../x.json", "a/b.json", "a\\b.json", "/abs.json", "nul\0.json"] {
      assert!(share_file_name(bad).is_err(), "{bad:?} was accepted as a share name");
    }
  }
}
