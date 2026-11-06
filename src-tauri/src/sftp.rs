//! The file browser's SFTP commands, through psftp.

use super::*;

/// What an SFTP error should add when it asks for a password.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PasswordNote {
    None,
    /// The vault was locked: a saved password would come from there.
    VaultLocked,
    /// The session goes through PuTTY's SSH jump host: no password is sent.
    ViaJumpHost,
}

/// Whether SFTP for this saved session must send no password: it goes
/// through PuTTY's SSH jump host (`ProxyMethod=6`), and psftp's `-pwfile`
/// would offer the final host's password to the jump host too. The
/// terminal never sends one there either (terminal.rs, jump_login).
pub(crate) fn withholds_password(saved: Option<&PuttySession>) -> bool {
    saved.is_some_and(|s| s.extra.get("ProxyMethod").is_some_and(|m| m == "6"))
}

/// Where an SFTP call goes and the password it uses. A password typed into
/// the SFTP pane wins; otherwise the session's vault entry is read here, in
/// the backend, so the secret never passes through the webview. A saved
/// session always connects with -load (its own host), so its entry can't be
/// sent anywhere else, except through a jump host: then nothing is sent
/// (`withholds_password`).
pub(crate) async fn sftp_target(
    session_name: &str,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    vault_state: &VaultState,
) -> (Option<plinky_core::transport::plink::ExplicitTarget>, Option<String>, PasswordNote) {
    let explicit = hostname.as_deref().is_some_and(|h| !h.is_empty());
    if !explicit && withholds_password(putty_compat::sessions::read_session(session_name).ok().as_ref()) {
        return (None, None, PasswordNote::ViaJumpHost);
    }
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
    (target, vault_pwd, if locked { PasswordNote::VaultLocked } else { PasswordNote::None })
}

/// SFTP error as the pane shows it; a password request says where a saved
/// one would come from, or why none is sent.
pub(crate) fn sftp_error(e: plinky_core::errors::PlinkyError, note: PasswordNote) -> String {
    let msg = shown(e);
    if !msg.starts_with(plinky_core::sftp::client::ERR_PASSWORD) {
        return msg;
    }
    match note {
        PasswordNote::VaultLocked => format!("{msg} If it's saved in the vault, unlock the vault and retry."),
        // Without the password prefix: the pane offers no password box,
        // since nothing typed there would be sent either.
        PasswordNote::ViaJumpHost => "This session goes through a jump host, and the file browser sends no password \
            there: the jump host could see it. Log in to it with a key (an SSH key or Pageant) to browse its files."
            .to_string(),
        PasswordNote::None => msg,
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::home_dir(&session_name, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::list_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::create_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::remove_file(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::remove_dir(&session_name, &remote_path, target.as_ref(), pwd.as_deref()).await.map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::upload_file(&session_name, &local_path, &remote_path, target.as_ref(), pwd.as_deref())
        .await
        .map_err(|e| sftp_error(e, note))
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
    let (target, pwd, note) = sftp_target(&session_name, hostname, port, username, password, &vault_state).await;
    PsftpClient::download_file(&session_name, &remote_path, &local_path, target.as_ref(), pwd.as_deref())
        .await
        .map_err(|e| sftp_error(e, note))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn session(extra: &[(&str, &str)]) -> PuttySession {
        let mut s = PuttySession { name: "Router".into(), host_name: "192.0.2.5".into(), ..Default::default() };
        for (k, v) in extra {
            s.extra.insert((*k).into(), (*v).into());
        }
        s
    }

    #[test]
    fn a_session_through_an_ssh_jump_host_sends_no_password() {
        // psftp's -pwfile would offer the final host's password to the jump
        // host as well.
        assert!(withholds_password(Some(&session(&[("ProxyMethod", "6"), ("ProxyHost", "bastion")]))));
        assert!(!withholds_password(Some(&session(&[]))));
        assert!(!withholds_password(Some(&session(&[("ProxyMethod", "3")]))), "an HTTP proxy sees no SSH password");
        assert!(!withholds_password(None));
    }

    #[test]
    fn a_password_request_through_a_jump_host_says_why_and_offers_no_password_box() {
        let asked = plinky_core::errors::PlinkyError::ProcessError(format!(
            "{}This server needs a password.",
            plinky_core::sftp::client::ERR_PASSWORD
        ));
        let msg = sftp_error(asked, PasswordNote::ViaJumpHost);
        assert!(msg.contains("jump host"), "{msg}");
        assert!(!msg.starts_with(plinky_core::sftp::client::ERR_PASSWORD), "{msg}");
    }
}
