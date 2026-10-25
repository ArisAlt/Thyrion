//! The system clipboard, for the page (the webview can't read it itself).

/// The clipboard's text, read here rather than by the page: the webview
/// blocks the page from reading the clipboard (wry's clipboard access is
/// off), so pasting from a browser or any other program gave nothing, on
/// Linux and on Windows. Off the main thread: on Linux, when Thyrion itself
/// owns the clipboard, the read waits for the GTK main loop to hand the
/// text over. Nothing (or no text) on the clipboard reads as "".
#[tauri::command]
pub(crate) async fn read_clipboard_text(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    tauri::async_runtime::spawn_blocking(move || app.clipboard().read_text().unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
}

/// Puts text on the clipboard: copies, and clearing a vault password after
/// 25 s -- from a timer, where a webview may refuse the page's own write.
#[tauri::command]
pub(crate) async fn write_clipboard_text(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    tauri::async_runtime::spawn_blocking(move || app.clipboard().write_text(text).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
