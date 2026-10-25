//! PuTTY itself: finding plink, and PuTTY's own saved sessions, host keys and key files.

use super::*;

/// PuTTY found once is not looked for again: finding it starts two
/// processes, and the title bar and Settings both ask. Not found is asked
/// again, so installing PuTTY while Thyrion runs is noticed.
pub(crate) static PUTTY_FOUND: std::sync::OnceLock<PuttyInfo> = std::sync::OnceLock::new();

#[tauri::command]
pub(crate) async fn putty_detect() -> Result<PuttyInfo, String> {
    if let Some(info) = PUTTY_FOUND.get() {
        return Ok(info.clone());
    }
    let info = off_main(PlinkTransport::detect_putty).await?;
    if info.ok {
        let _ = PUTTY_FOUND.set(info.clone());
    }
    Ok(info)
}

#[tauri::command]
pub(crate) async fn list_putty_sessions() -> Result<Vec<PuttySession>, String> {
    off_main(list_putty_sessions_now).await?
}

pub(crate) fn list_putty_sessions_now() -> Result<Vec<PuttySession>, String> {
    let session_refs = putty_compat::sessions::list_sessions()
        .map_err(|e| format!("Failed to list PuTTY sessions: {e}"))?;

    let mut sessions = Vec::new();
    for s_ref in session_refs {
        if let Ok(sess) = putty_compat::sessions::read_session(&s_ref.name) {
            sessions.push(sess);
        }
    }
    Ok(sessions)
}

#[tauri::command]
pub(crate) async fn read_putty_session(name: String) -> Result<PuttySession, String> {
    off_main(move || {
        putty_compat::sessions::read_session(&name)
            .map_err(|e| format!("Failed to read PuTTY session '{name}': {e}"))
    }).await?
}

#[tauri::command]
pub(crate) async fn write_putty_session(session: PuttySession) -> Result<(), String> {
    off_main(move || {
        putty_compat::sessions::write_session(&session)
            .map_err(|e| format!("Failed to write PuTTY session '{}': {e}", session.name))
    }).await?
}

/// Removes a saved session the way PuTTY's own Delete does (registry key on
/// Windows, session file elsewhere). There was no way to delete a session
/// from Thyrion, so stale ones piled up forever.
#[tauri::command]
pub(crate) async fn delete_putty_session(name: String) -> Result<(), String> {
    off_main(move || {
        putty_compat::sessions::delete_session(&name)
            .map_err(|e| format!("Failed to delete PuTTY session '{name}': {e}"))
    }).await?
}

/// A folder rename or move: every session's new folder path in one call,
/// saved all or nothing (see `set_session_folders`).
#[tauri::command]
pub(crate) async fn set_session_folders(changes: Vec<(String, String)>) -> Result<(), String> {
    off_main(move || {
        putty_compat::sessions::set_session_folders(&changes)
            .map_err(|e| format!("Failed to move sessions between folders: {e}"))
    }).await?
}

#[tauri::command]
pub(crate) async fn list_putty_hostkeys() -> Result<Vec<HostKeyEntry>, String> {
    off_main(move || {
        putty_compat::hostkeys::list_host_keys()
            .map_err(|e| format!("Failed to read PuTTY hostkeys: {e}"))
    }).await?
}

#[tauri::command]
pub(crate) async fn inspect_ppk(path: String) -> Result<PpkHeader, String> {
    off_main(move || {
        putty_compat::ppk::read_header(std::path::Path::new(&path))
            .map_err(|e| format!("Failed to parse PPK header for '{path}': {e}"))
    }).await?
}

/// Forgets one cached host key (PuTTY's sshhostkeys line, or its registry
/// value on Windows); the next connection to that host asks again.
#[tauri::command]
pub(crate) async fn remove_putty_hostkey(key_type: String, hostname: String, port: u16) -> Result<bool, String> {
    off_main(move || {
        putty_compat::remove_host_key(&key_type, &hostname, port)
            .map_err(|e| format!("Failed to remove the host key for {hostname}:{port}: {e}"))
    }).await?
}

/// Asks for a .ppk file. The Host Keys screen's "Inspect .ppk" used a
/// hard-coded example path, so it could never inspect a real key.
#[tauri::command]
pub(crate) async fn pick_ppk_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Inspect a PuTTY private key")
        .add_filter("PuTTY private key", &["ppk"])
        .pick_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Some(picked) = rx.await.map_err(|_| "The file dialog closed unexpectedly".to_string())? else {
        return Ok(None);
    };
    Ok(Some(picked.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned()))
}
