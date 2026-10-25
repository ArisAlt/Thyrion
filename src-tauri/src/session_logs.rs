//! Session logs: one started from a tab's menu, and automatic ones (Settings > Logging).

use super::*;

/// Where a session log is being written, and how much is on disk.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionLogInfo {
    path: String,
    bytes: u64,
}

pub(crate) fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Asks where to save the session's log, then writes its output there from
/// now on, as it arrives (on disk, live, not in memory).
/// `None` when the user cancels the dialog.
#[tauri::command]
pub(crate) async fn start_session_log(
    app: tauri::AppHandle,
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    session_name: String,
    mode: plinky_core::session::log::LogMode,
) -> Result<Option<SessionLogInfo>, String> {
    use tauri_plugin_dialog::DialogExt;
    let dir = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?
        .join("Thyrion Logs");
    // The dialog opens in this folder; it has to exist to be offered.
    let _ = std::fs::create_dir_all(&dir);
    let suggested = plinky_core::session::log::default_log_path(&dir, &session_name, unix_now());
    let file_name = suggested.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save session log")
        .add_filter("Log file", &["log", "txt"])
        .set_directory(&dir)
        .set_file_name(&file_name)
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Some(picked) = rx.await.map_err(|_| "The save dialog closed unexpectedly".to_string())? else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let path = registry.start_log(&session_id, &path, mode).map_err(shown)?;
    Ok(Some(SessionLogInfo { path: path.display().to_string(), bytes: 0 }))
}

#[tauri::command]
pub(crate) fn stop_session_log(registry: State<'_, Arc<SessionRegistry>>, session_id: String) {
    registry.stop_log(&session_id);
}

#[tauri::command]
pub(crate) fn session_log_status(registry: State<'_, Arc<SessionRegistry>>, session_id: String) -> Option<SessionLogInfo> {
    registry
        .log_status(&session_id)
        .map(|(path, bytes)| SessionLogInfo { path: path.display().to_string(), bytes })
}

/// Where the automatic-log setting is kept: the backend's own file, since a
/// GNS3 console starts (and may need logging) before the page exists.
pub(crate) fn logging_settings_file(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("logging.json"))
}

pub(crate) fn logging_settings(app: &tauri::AppHandle) -> plinky_core::session::autolog::LoggingSettings {
    logging_settings_file(app)
        .map(|f| plinky_core::session::autolog::LoggingSettings::load(&f))
        .unwrap_or_default()
}

/// Documents/Thyrion Logs, where the manual log's dialog opens too.
pub(crate) fn default_logs_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("Thyrion Logs")
}

/// The automatic log for a session about to start, if it gets one:
/// `<log folder>/<session folder>/<session>/<local time>.log`. A saved
/// session's `PlinkyAutoLog` decides for it, the global setting for the
/// rest; one that isn't saved (a GNS3 console, a quick connect, the local
/// shell) goes under "Unsaved", by its tab's title: a GNS3 console's session
/// name is telnet://host:port (cli.rs), the title is the device.
pub(crate) fn auto_log_for(
    app: &tauri::AppHandle,
    session_name: &str,
    title: Option<&str>,
    is_local: bool,
) -> Option<(std::path::PathBuf, plinky_core::session::log::LogMode)> {
    use plinky_core::session::autolog::{log_path, session_choice, wanted, Stamp};
    let settings = logging_settings(app);
    let saved = (!is_local).then(|| putty_compat::sessions::read_session(session_name).ok()).flatten();
    if !wanted(&settings, saved.as_ref().and_then(|s| session_choice(&s.extra))) {
        return None;
    }
    // A saved session with no folder of its own is listed under "Saved
    // Sessions": its logs go there too.
    let folder = saved.as_ref().map(|s| s.extra.get("PlinkyFolder").cloned().unwrap_or_else(|| "Saved Sessions".into()));
    let dir = settings.dir.clone().unwrap_or_else(|| default_logs_dir(app));
    let name = match (&saved, title.map(str::trim).filter(|t| !t.is_empty())) {
        (None, Some(title)) => title,
        _ => session_name,
    };
    Some((log_path(&dir, folder.as_deref(), name, Stamp::now_local()), settings.mode))
}

/// The automatic-log setting, as Settings shows it.
#[derive(serde::Serialize)]
pub(crate) struct LoggingSettingsView {
    enabled: bool,
    /// The folder in use, the default one included.
    dir: String,
    /// Whether that folder is the default.
    default_dir: bool,
    mode: plinky_core::session::log::LogMode,
}

#[tauri::command]
pub(crate) fn get_logging_settings(app: tauri::AppHandle) -> LoggingSettingsView {
    let s = logging_settings(&app);
    LoggingSettingsView {
        enabled: s.enabled,
        default_dir: s.dir.is_none(),
        dir: s.dir.clone().unwrap_or_else(|| default_logs_dir(&app)).display().to_string(),
        mode: s.mode,
    }
}

/// Saves the automatic-log setting. `dir` empty or absent: the default
/// folder. Applies to sessions started from now on.
#[tauri::command]
pub(crate) fn set_logging_settings(
    app: tauri::AppHandle,
    enabled: bool,
    dir: Option<String>,
    mode: plinky_core::session::log::LogMode,
) -> Result<LoggingSettingsView, String> {
    let file = logging_settings_file(&app).ok_or("No app data folder to keep the setting in")?;
    let dir = dir.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()).map(std::path::PathBuf::from);
    if let Some(d) = &dir {
        // A relative folder would land wherever the app happens to run.
        if !d.is_absolute() {
            return Err(format!("Choose a full folder path, not \"{}\"", d.display()));
        }
    }
    plinky_core::session::autolog::LoggingSettings { enabled, dir, mode }
        .save(&file)
        .map_err(|e| format!("Couldn't save the logging setting: {e}"))?;
    Ok(get_logging_settings(app))
}

/// Asks for the folder automatic logs go to; `None` if the dialog was
/// cancelled.
#[tauri::command]
pub(crate) async fn pick_log_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let start = std::path::PathBuf::from(get_logging_settings(app.clone()).dir);
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut dialog = app.dialog().file().set_title("Folder for session logs");
    if start.is_dir() {
        dialog = dialog.set_directory(&start);
    }
    dialog.pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let Some(picked) = rx.await.map_err(|_| "The folder dialog closed unexpectedly".to_string())? else {
        return Ok(None);
    };
    Ok(Some(picked.into_path().map_err(|e| e.to_string())?.display().to_string()))
}

/// PuTTY's own per-session logging: `LogType` 1 (printable) or 2 (all
/// output) with a `LogFileName`. Thyrion parsed the name but never used it:
/// the page passes none, so a session set up to log in PuTTY logged nothing
/// here. Other types (SSH packets, raw) aren't session output; they're off.
pub(crate) fn putty_session_log(saved: &putty_compat::sessions::PuttySession, now: u64) -> Option<(std::path::PathBuf, plinky_core::session::log::LogMode)> {
    use plinky_core::session::log::{expand_putty_log_name, LogMode};
    // Both are saved as plain text (no colour codes in logs). PuTTY's
    // "all output" kept them, and an editor shows them as [01;34m...[0m.
    let mode = match saved.extra.get("LogType").map(String::as_str) {
        Some("1") | Some("2") => LogMode::Printable,
        _ => return None,
    };
    if saved.log_file_name.trim().is_empty() {
        return None;
    }
    let home = std::path::PathBuf::from(plinky_core::sftp::client::PsftpClient::get_local_home_dir());
    Some((expand_putty_log_name(&saved.log_file_name, &saved.host_name, saved.port_number, now, &home), mode))
}
