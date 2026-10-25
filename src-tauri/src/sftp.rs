//! The file browser's SFTP commands, through psftp.

use super::*;

/// Where an SFTP call goes and the password it uses. A password typed into
/// the SFTP pane wins; otherwise the session's vault entry is read here, in
/// the backend, so the secret never passes through the webview. A saved
/// session always connects with -load (its own host), so its entry can't be
/// sent anywhere else. The flag says the vault was locked, so a password
/// prompt can say where a saved one would come from.
pub(crate) async fn sftp_target(
    session_name: &str,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: &VaultState,
) -> (Option<plinky_core::transport::plink::ExplicitTarget>, Option<String>, bool) {
    let guard = vault_state.inner.lock().await;
    let locked = guard.is_none();
    let vault_pwd = if password.as_deref().is_some_and(|p| !p.is_empty()) {
        password
    } else {
        guard.as_ref().and_then(|v| {
            find_session_entry(v, session_name, hostname.as_deref(), username.as_deref())
                .filter(|e| e.has_login())
                .map(|e| e.secret.expose_secret().to_string())
        })
    };
    drop(guard);
    let target = hostname
        .filter(|h| !h.is_empty())
        .map(|h| plinky_core::transport::plink::ExplicitTarget {
            hostname: h,
            port: port.unwrap_or(22),
            username,
            protocol: Default::default(), // SFTP is SSH
        });
    (target, vault_pwd, locked)
}

/// SFTP error as the pane shows it; a password request mentions the vault
/// when it was locked.
pub(crate) fn sftp_error(e: plinky_core::errors::PlinkyError, vault_locked: bool) -> String {
    let msg = shown(e);
    if vault_locked && msg.starts_with(plinky_core::sftp::client::ERR_PASSWORD) {
        format!("{msg} If it's saved in the vault, unlock the vault and retry.")
    } else {
        msg
    }
}

#[tauri::command]
pub(crate) async fn sftp_home_dir(
    session_name: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::home_dir(&session_name, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
pub(crate) async fn sftp_list(
    session_name: String,
    remote_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<Vec<SftpFileEntry>, String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::list_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
pub(crate) async fn sftp_mkdir(
    session_name: String,
    remote_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::create_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
pub(crate) async fn sftp_rm(
    session_name: String,
    remote_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::remove_file(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
pub(crate) async fn sftp_rmdir(
    session_name: String,
    remote_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::remove_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_upload(
    session_name: String,
    local_path: String,
    remote_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::upload_file(&session_name, &local_path, &remote_path, target.as_ref(), pwd.as_deref())
        .await
        .map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn sftp_download(
    session_name: String,
    remote_path: String,
    local_path: String,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: State<'_, VaultState>,
) -> Result<(), String> {
    let (target, pwd, locked) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::download_file(&session_name, &remote_path, &local_path, target.as_ref(), pwd.as_deref())
        .await
        .map_err(|e| sftp_error(e, locked))
}

#[tauri::command]
pub(crate) async fn sftp_list_local(local_path: String) -> Result<Vec<SftpFileEntry>, String> {
    off_main(move || {
        PsftpClient::list_local_dir(&local_path).map_err(shown)
    }).await?
}

#[tauri::command]
pub(crate) async fn sftp_get_home_dir() -> Result<String, String> {
    off_main(move || {
        PsftpClient::get_local_home_dir()
    }).await
}
