//! Run Script and Stop, as the terminal's menu calls them (the work is in scripts.rs).

use super::*;

/// Scripts picked in Run Script's file dialog and not run yet. Run Script
/// runs only these: the page could otherwise have the backend run any
/// program it named, and nothing but the dialog should decide that. Debug
/// builds (the e2e suite, which can't click a native dialog) run any path.
#[derive(Default)]
pub(crate) struct PickedScripts(std::sync::Mutex<std::collections::HashSet<String>>);

/// Asks for a script to run on a terminal (Run Script).
#[tauri::command]
pub(crate) async fn pick_script_file(app: tauri::AppHandle, picked_scripts: State<'_, PickedScripts>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Run a script on this session")
        .add_filter("Scripts", &["py", "sh", "ps1", "bat", "cmd"])
        .add_filter("All files", &["*"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Some(picked) = rx.await.map_err(|_| "The file dialog closed unexpectedly".to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    picked_scripts.0.lock().unwrap_or_else(|p| p.into_inner()).insert(path.clone());
    Ok(Some(path))
}

#[tauri::command]
pub(crate) fn run_script(
    app: tauri::AppHandle,
    registry: State<'_, Arc<SessionRegistry>>,
    picked_scripts: State<'_, PickedScripts>,
    session_id: String,
    session_name: String,
    path: String,
) -> Result<(), String> {
    let picked = picked_scripts.0.lock().unwrap_or_else(|p| p.into_inner()).remove(&path);
    if !picked && !cfg!(debug_assertions) {
        return Err("Pick the script with Run Script first".into());
    }
    scripts::start(&app, registry.inner().clone(), session_id, session_name, path)
}

#[tauri::command]
pub(crate) fn stop_script(app: tauri::AppHandle, registry: State<'_, Arc<SessionRegistry>>, session_id: String) {
    scripts::stop(&app, &registry, &session_id);
}
