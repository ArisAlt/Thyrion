//! The vault: its commands, and finding a session's entry (and a jump host's) in it.

use super::*;

/// A backend error as the UI shows it. PlinkyError's Display prefixes
/// "Process error:", which buried messages meant for the user -- and the
/// "[password]"/"[hostkey]" tags the SFTP pane acts on.
pub(crate) fn shown(e: plinky_core::errors::PlinkyError) -> String {
    match e {
        plinky_core::errors::PlinkyError::ProcessError(msg) => msg,
        other => other.to_string(),
    }
}

/// The vault entry names that hold a session's password, best first. An
/// explicit link from the session editor (PlinkyVaultKey) wins. After it
/// come the names the Vault screen itself suggests for a key --
/// "session:prod-web or server.internal". Nothing used to honour those:
/// an entry saved as "session:Server 2" or "192.0.2.10" was ignored, so
/// SFTP asked for a password and the terminal never offered the vault.
/// src/services/vaultKeys.ts has the same rule, to tell which sessions use
/// an entry before one is deleted: keep the two in step.
pub(crate) fn vault_key_candidates(
    session_name: &str,
    explicit: Option<&str>,
    host: Option<&str>,
    user: Option<&str>,
) -> Vec<String> {
    let mut keys = Vec::new();
    let mut push = |k: String| {
        if !k.is_empty() && !keys.contains(&k) {
            keys.push(k);
        }
    };
    if let Some(k) = explicit {
        push(k.to_string());
    }
    push(format!("session:{session_name}"));
    push(session_name.to_string());
    if let Some(h) = host.filter(|h| !h.is_empty()) {
        if let Some(u) = user.filter(|u| !u.is_empty()) {
            push(format!("{u}@{h}"));
        }
        push(h.to_string());
    }
    keys
}

/// The vault entry for a session, if the vault is unlocked and has one.
/// A saved session's own host and user are used (it connects with -load
/// to that host), otherwise the ones the caller passes (Quick Connect).
pub(crate) fn find_session_entry<'v>(
    vault: &'v Vault,
    session_name: &str,
    hostname: Option<&str>,
    username: Option<&str>,
) -> Option<&'v VaultEntry> {
    let saved = putty_compat::sessions::read_session(session_name).ok();
    find_session_entry_for(vault, saved.as_ref(), session_name, hostname, username)
}

/// [`find_session_entry`] given the saved session (if any) instead of
/// reading it: the test runs on Windows too, where sessions live in the
/// registry and a file under PUTTYDIR is never read.
pub(crate) fn find_session_entry_for<'v>(
    vault: &'v Vault,
    saved: Option<&putty_compat::sessions::PuttySession>,
    session_name: &str,
    hostname: Option<&str>,
    username: Option<&str>,
) -> Option<&'v VaultEntry> {
    let (explicit, host, user) = match saved {
        Some(s) => (
            s.extra.get("PlinkyVaultKey").map(String::as_str),
            Some(s.host_name.as_str()),
            Some(s.user_name.as_str()),
        ),
        None => (None, hostname, username),
    };
    vault_key_candidates(session_name, explicit, host, user)
        .iter()
        .find_map(|k| vault.get_entry(k))
}

/// For a saved session through PuTTY's SSH proxy (`ProxyMethod=6`): the
/// vault logins for the jump host and the final host, answered at their
/// prompts by `plinky_core::session::jump_login`. `None` when the session
/// has no such jump host.
///
/// The jump host is `ProxyHost`, which PuTTY also accepts as the name of a
/// saved session: then that session's host, port and user apply (unless
/// `ProxyUsername` overrides the user), and so does its vault entry.
/// Otherwise the jump entry is `PlinkyJumpVaultKey`, then `jump:<session>`,
/// `<user>@<host>`, `<host>`.
///
/// A login needs a user name: without one plink asks "login as:", which
/// this doesn't answer, so that side is left to the user.
pub(crate) fn jump_credentials_for(
    vault: &Vault,
    saved: &putty_compat::sessions::PuttySession,
    read: impl Fn(&str) -> Option<putty_compat::sessions::PuttySession>,
) -> Option<plinky_core::session::jump_login::JumpCredentials> {
    use plinky_core::session::jump_login::{JumpCredentials, Login};
    if saved.extra.get("ProxyMethod").map(String::as_str) != Some("6") {
        return None;
    }
    let (host, port, user, entry) = jump_host_of(Some(vault), saved, &read)?;
    let jump = entry.filter(|e| !user.is_empty() && e.has_login()).map(|e| Login {
        user,
        host,
        port,
        password: e.secret.clone(),
    });

    let target = find_session_entry_for(vault, Some(saved), &saved.name, None, None)
        .filter(|e| !saved.user_name.is_empty() && e.has_login())
        .map(|e| Login {
            user: saved.user_name.clone(),
            host: saved.host_name.clone(),
            port: saved.port_number,
            password: e.secret.clone(),
        });
    Some(JumpCredentials { jump, target })
}

/// The jump host a session names (`ProxyHost`, or a saved session by that
/// name), its port, user, and vault entry if the vault is open.
pub(crate) fn jump_host_of<'v>(
    vault: Option<&'v Vault>,
    saved: &putty_compat::sessions::PuttySession,
    read: &impl Fn(&str) -> Option<putty_compat::sessions::PuttySession>,
) -> Option<(String, u16, String, Option<&'v plinky_core::vault::VaultEntry>)> {
    let extra = |k: &str| saved.extra.get(k).map(String::as_str).unwrap_or("");
    if extra("ProxyHost").is_empty() {
        return None;
    }
    let proxy_host = extra("ProxyHost");
    let proxy_user = extra("ProxyUsername");

    Some(match read(proxy_host) {
        Some(preset) => {
            let user = if proxy_user.is_empty() { preset.user_name.clone() } else { proxy_user.to_string() };
            let entry = vault.and_then(|v| find_session_entry_for(v, Some(&preset), &preset.name, None, None));
            (preset.host_name.clone(), preset.port_number, user, entry)
        }
        None => {
            let explicit = Some(extra("PlinkyJumpVaultKey")).filter(|k| !k.is_empty());
            let keys = vault_key_candidates(&format!("jump:{}", saved.name), explicit, Some(proxy_host), Some(proxy_user));
            // vault_key_candidates adds "session:jump:<name>" and the bare
            // name too; harmless, nothing else is stored under them.
            let entry = vault.and_then(|v| keys.iter().find_map(|k| v.get_entry(k)));
            let port = extra("ProxyPort").parse().unwrap_or(22);
            (proxy_host.to_string(), port, proxy_user.to_string(), entry)
        }
    })
}

/// The hop command for a jump through a device's CLI, NX-OS style by
/// default: IOS wants `ssh -l {user} {host}`.
pub const DEFAULT_HOP_COMMAND: &str = "ssh {user}@{host}";

/// A session that goes through a router or switch's CLI instead of a
/// tunnel (`PlinkyJumpMode=cli`): where plink connects (the first device)
/// and the script that logs in and hops (see plinky_core::session::expect).
/// A locked vault still hops: only the passwords are left to the user.
pub(crate) fn cli_jump_plan(
    vault: Option<&Vault>,
    saved: &putty_compat::sessions::PuttySession,
    read: impl Fn(&str) -> Option<putty_compat::sessions::PuttySession>,
) -> Option<(plinky_core::transport::plink::ExplicitTarget, plinky_core::session::expect::Expect)> {
    use plinky_core::session::expect::{cli_prompt, hop_command, hop_failures, password_prompt, Expect, Reply, Step};
    if saved.extra.get("PlinkyJumpMode").map(String::as_str) != Some("cli") {
        return None;
    }
    let (host, port, user, entry) = jump_host_of(vault, saved, &read)?;
    let first_hop = plinky_core::transport::plink::ExplicitTarget {
        hostname: host,
        port,
        username: Some(user).filter(|u| !u.is_empty()),
        protocol: plinky_core::transport::plink::TargetProtocol::Ssh,
    };
    let template = saved
        .extra
        .get("PlinkyJumpCommand")
        .map(String::as_str)
        .filter(|c| !c.trim().is_empty())
        .unwrap_or(DEFAULT_HOP_COMMAND);
    let command = hop_command(template, &saved.user_name, &saved.host_name, saved.port_number);
    let target_entry = vault
        .and_then(|v| find_session_entry_for(v, Some(saved), &saved.name, None, None))
        .filter(|e| e.has_login());

    let mut steps = Vec::new();
    if let Some(e) = entry.filter(|e| e.has_login()) {
        steps.push(Step { expect: password_prompt(), reply: Reply::Secret(e.secret.clone()), label: "jump password" });
    }
    steps.push(Step { expect: cli_prompt(), reply: Reply::Line(command), label: "hop command" });
    if let Some(e) = target_entry {
        steps.push(Step { expect: password_prompt(), reply: Reply::Secret(e.secret.clone()), label: "target password" });
    }
    Some((first_hop, Expect::new(steps, hop_failures())))
}

/// What the terminal needs to offer the vault: which entry (never its
/// secret) and whether the vault is locked.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VaultLookup {
    locked: bool,
    key: Option<String>,
    has_enable_secret: bool,
    /// Whether it has a login password: an entry may hold only an enable
    /// password, for a console that asks for no login.
    has_login_secret: bool,
    /// The entry's username (not a secret), for Telnet/serial login prompts.
    username: Option<String>,
    /// Session opt-ins, from the session file.
    auto_login: bool,
    auto_enable: bool,
}

#[tauri::command]
pub(crate) async fn vault_lookup(
    vault_state: State<'_, VaultState>,
    session_name: String,
    hostname: Option<String>,
    username: Option<String>,
) -> Result<VaultLookup, String> {
    let flag = |k: &str| {
        putty_compat::sessions::read_session(&session_name)
            .map(|s| s.extra.get(k).is_some_and(|v| v == "1"))
            .unwrap_or(false)
    };
    let (auto_login, auto_enable) = (flag("PlinkyAutoLogin"), flag("PlinkyAutoEnable"));
    let guard = vault_state.inner.lock().await;
    let Some(vault) = guard.as_ref() else {
        return Ok(VaultLookup {
            locked: true, key: None, has_enable_secret: false, has_login_secret: false, username: None, auto_login, auto_enable,
        });
    };
    let entry = find_session_entry(vault, &session_name, hostname.as_deref(), username.as_deref());
    Ok(VaultLookup {
        locked: false,
        key: entry.map(|e| e.id.clone()),
        has_enable_secret: entry.is_some_and(|e| e.has_enable()),
        has_login_secret: entry.is_some_and(|e| e.has_login()),
        username: entry.and_then(|e| e.username.clone()),
        auto_login,
        auto_enable,
    })
}

pub struct VaultState {
    pub inner: Mutex<Option<Vault>>,
    pub custom_path: Mutex<Option<PathBuf>>,
}

impl VaultState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            custom_path: Mutex::new(None),
        }
    }
}

pub(crate) fn resolve_vault_path(app: &tauri::AppHandle, state: &VaultState) -> PathBuf {
    if let Ok(guard) = state.custom_path.try_lock() {
        if let Some(p) = guard.as_ref() {
            return p.clone();
        }
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        return app_dir.join("vault.bin");
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("vault.bin")
}

#[tauri::command]
pub(crate) fn vault_is_initialized(app: tauri::AppHandle, state: State<'_, VaultState>) -> Result<bool, String> {
    let path = resolve_vault_path(&app, &state);
    Ok(path.exists())
}

/// Deletes the vault for good -- the Settings screen's "Delete vault",
/// after its two warnings. No master password is asked: a forgotten one is
/// the usual reason to start over. The vault is locked first, so no secret
/// stays in memory (entries zeroize on drop) for a vault that's gone.
/// Ok(false) means there was no vault file to delete.
#[tauri::command]
pub(crate) async fn vault_destroy(app: tauri::AppHandle, state: State<'_, VaultState>) -> Result<bool, String> {
    let path = resolve_vault_path(&app, &state);
    *state.inner.lock().await = None;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Couldn't delete the vault ({}): {e}", path.display())),
    }
}

#[tauri::command]
pub(crate) async fn vault_is_unlocked(state: State<'_, VaultState>) -> Result<bool, String> {
    let guard = state.inner.lock().await;
    Ok(guard.as_ref().map(|v| !v.is_locked()).unwrap_or(false))
}

#[tauri::command]
pub(crate) async fn vault_create(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    master_password: String,
) -> Result<(), String> {
    let path = resolve_vault_path(&app, &state);
    let vault = Vault::create(&path, &master_password)
        .map_err(|e| format!("Failed to create vault: {e}"))?;
    let mut guard = state.inner.lock().await;
    *guard = Some(vault);
    Ok(())
}

#[tauri::command]
pub(crate) async fn vault_unlock(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    master_password: String,
) -> Result<(), String> {
    let path = resolve_vault_path(&app, &state);
    let vault = Vault::load(&path, &master_password)
        .map_err(|e| format!("Failed to unlock vault: {e}"))?;
    let mut guard = state.inner.lock().await;
    *guard = Some(vault);
    Ok(())
}

#[tauri::command]
pub(crate) async fn vault_lock(state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    if let Some(mut v) = guard.take() {
        v.lock();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn vault_get(state: State<'_, VaultState>, key: String) -> Result<Option<String>, String> {
    let guard = state.inner.lock().await;
    let vault = guard.as_ref().ok_or_else(|| "Vault is locked".to_string())?;
    Ok(vault.get(&key).map(|s| s.to_string()))
}

#[tauri::command]
pub(crate) async fn vault_set(
    state: State<'_, VaultState>,
    key: String,
    secret: String,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let vault = guard.as_mut().ok_or_else(|| "Vault is locked".to_string())?;
    vault.set(&key, &secret);
    vault.save().map_err(|e| format!("Failed to save vault: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn vault_get_entry(
    state: State<'_, VaultState>,
    key: String,
) -> Result<Option<VaultEntry>, String> {
    let guard = state.inner.lock().await;
    let vault = guard.as_ref().ok_or_else(|| "Vault is locked".to_string())?;
    Ok(vault.get_entry(&key).cloned())
}

/// Types a vault entry's login (`field = "login"`) or enable password into a
/// session, followed by Enter. The terminal's "Send password" used to fetch
/// the whole entry into the webview and keep it in component state, so
/// after the vault was locked an open tab still sent the password. Here the
/// secret goes from the vault to the session inside the backend and a
/// locked vault refuses.
#[tauri::command]
pub(crate) async fn vault_send_secret(
    registry: State<'_, Arc<SessionRegistry>>,
    vault_state: State<'_, VaultState>,
    session_id: String,
    key: String,
    field: String,
) -> Result<(), String> {
    let guard = vault_state.inner.lock().await;
    let vault = guard.as_ref().ok_or_else(|| "The vault is locked".to_string())?;
    let entry = vault.get_entry(&key).ok_or_else(|| format!("No vault entry '{key}'"))?;
    let secret = match field.as_str() {
        "login" if entry.has_login() => &entry.secret,
        "login" => return Err(format!("Vault entry '{key}' has no login password")),
        "enable" => entry
            .enable_secret
            .as_ref()
            .filter(|_| entry.has_enable())
            .ok_or_else(|| format!("Vault entry '{key}' has no enable password"))?,
        other => return Err(format!("Unknown vault field '{other}'")),
    };
    registry.type_secret(&session_id, secret).map_err(shown)
}

/// Where a vault entry points, for the KeePass URL field: an entry keyed
/// "session:<name>" belongs to that saved session.
pub(crate) fn session_url_for_entry(id: &str) -> Option<String> {
    session_url_for_entry_with(id, |name| putty_compat::sessions::read_session(name).ok())
}

pub(crate) fn session_url_for_entry_with(
    id: &str,
    read: impl Fn(&str) -> Option<putty_compat::sessions::PuttySession>,
) -> Option<String> {
    let name = id.strip_prefix("session:")?;
    let s = read(name)?;
    if s.host_name.is_empty() {
        return None;
    }
    let scheme = match s.protocol.to_ascii_lowercase().as_str() {
        "" | "ssh" => "ssh",
        "telnet" => "telnet",
        "rlogin" => "rlogin",
        _ => return None, // serial/raw: no meaningful URL
    };
    let user = if s.user_name.is_empty() { String::new() } else { format!("{}@", s.user_name) };
    Some(format!("{scheme}://{user}{}:{}", s.host_name, s.port_number))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KdbxExport {
    path: String,
    entries: usize,
}

/// Exports the whole vault to a KeePass (KDBX 4) file chosen in a Save As
/// dialog, protected by the vault's own master password.
/// The password is checked against the vault file itself -- an export
/// hands every secret out in a new file, so it's asked for again even when
/// the vault is already unlocked -- and that same check reads the entries,
/// so a locked vault can be exported too. Ok(None) means the dialog was
/// cancelled.
#[tauri::command]
pub(crate) async fn vault_export_kdbx(
    app: tauri::AppHandle,
    state: State<'_, VaultState>,
    master_password: String,
) -> Result<Option<KdbxExport>, String> {
    use tauri_plugin_dialog::DialogExt;

    let vault_path = resolve_vault_path(&app, &state);
    if !vault_path.exists() {
        return Err("There is no vault to export yet.".into());
    }
    let vault = Vault::load(&vault_path, &master_password)
        .map_err(|_| "That isn't the vault's master password.".to_string())?;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Export vault to KeePass")
        .add_filter("KeePass database", &["kdbx"])
        .set_file_name("plinky-vault.kdbx")
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let Some(picked) = rx.await.map_err(|_| "The save dialog closed unexpectedly".to_string())? else {
        return Ok(None);
    };
    let mut dest = picked.into_path().map_err(|e| format!("Can't save there: {e}"))?;
    // GTK's dialog doesn't add the filter's extension; KeePass clients
    // recognise the file by it.
    if dest.extension().is_none_or(|e| !e.eq_ignore_ascii_case("kdbx")) {
        dest.set_extension("kdbx");
    }

    let entries = plinky_core::vault::keepass_export::export_kdbx(&vault, &dest, &master_password, session_url_for_entry)
        .map_err(shown)?;
    Ok(Some(KdbxExport { path: dest.display().to_string(), entries }))
}

#[tauri::command]
pub(crate) async fn vault_set_entry(
    state: State<'_, VaultState>,
    entry: VaultEntry,
) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let vault = guard.as_mut().ok_or_else(|| "Vault is locked".to_string())?;
    vault.set_entry(entry);
    vault.save().map_err(|e| format!("Failed to save vault: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn vault_delete(state: State<'_, VaultState>, key: String) -> Result<bool, String> {
    let mut guard = state.inner.lock().await;
    let vault = guard.as_mut().ok_or_else(|| "Vault is locked".to_string())?;
    let removed = vault.remove(&key).is_some();
    if removed {
        vault.save().map_err(|e| format!("Failed to save vault: {e}"))?;
    }
    Ok(removed)
}

#[tauri::command]
pub(crate) async fn vault_list_keys(state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    let guard = state.inner.lock().await;
    let vault = guard.as_ref().ok_or_else(|| "Vault is locked".to_string())?;
    Ok(vault.list_keys())
}

/// Lists entry metadata (id, username, notes, timestamps) WITHOUT decrypted
/// secrets. The frontend list view uses this so every credential's plaintext
/// isn't pulled into the webview just to render the list -- vault_get_entry
/// is fetched per-row only when the user explicitly reveals or copies it.
#[tauri::command]
pub(crate) async fn vault_list_entries_meta(
    state: State<'_, VaultState>,
) -> Result<Vec<VaultEntryMeta>, String> {
    let guard = state.inner.lock().await;
    let vault = guard.as_ref().ok_or_else(|| "Vault is locked".to_string())?;
    Ok(vault.list_entries_meta())
}

#[cfg(test)]
mod tests {
    use super::*;
    use plinky_core::{Vault, VaultEntry};

    /// The master password of a test's throwaway vault. Made at run time:
    /// CodeQL reads a fixed string here as a hard-coded password.
    fn throwaway_password() -> String {
        std::process::id().to_string()
    }

    #[test]
    fn vault_keys_follow_the_names_the_vault_screen_suggests() {
        let keys = vault_key_candidates("Server 2", None, Some("192.0.2.10"), Some("ops"));
        assert_eq!(keys, ["session:Server 2", "Server 2", "ops@192.0.2.10", "192.0.2.10"]);
        // An explicit link from the session editor is tried first.
        let keys = vault_key_candidates("Server 2", Some("shared-admin"), Some("192.0.2.10"), None);
        assert_eq!(keys[0], "shared-admin");
    }

    #[test]
    fn a_session_finds_its_vault_entry_without_an_explicit_link() {
        // The reported case: a password saved from the Vault screen, no
        // PlinkyVaultKey in the session file -- it used to be ignored.
        // The saved session is handed in rather than written to PUTTYDIR:
        // on Windows sessions are read from the registry, and this test
        // failed there once CI's Windows job got far enough to run it.
        let server2 = putty_compat::sessions::PuttySession {
            name: "Server 2".into(),
            host_name: "192.0.2.10".into(),
            port_number: 22,
            user_name: "ops".into(),
            protocol: "ssh".into(),
            ..Default::default()
        };
        let saved = |name: &str| (name == "Server 2").then(|| server2.clone());
        let dir = std::env::temp_dir().join(format!("plinky-vault-lookup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut vault = Vault::create_fast(dir.join("vault.bin"), &throwaway_password()).unwrap();

        vault.set_entry(VaultEntry::new("192.0.2.10", "by-host"));
        let e = find_session_entry_for(&vault, saved("Server 2").as_ref(), "Server 2", None, None).unwrap();
        assert_eq!(e.id, "192.0.2.10", "the saved session's own host is used");

        vault.set_entry(VaultEntry::new("session:Server 2", "by-session"));
        let e = find_session_entry_for(&vault, saved("Server 2").as_ref(), "Server 2", None, None).unwrap();
        assert_eq!(e.id, "session:Server 2");

        // Quick Connect: no saved session, so the host the tab connects to.
        vault.set_entry(VaultEntry::new("192.0.2.7", "quick"));
        assert_eq!(find_session_entry_for(&vault, None, "192.0.2.7:22", Some("192.0.2.7"), None).unwrap().id, "192.0.2.7");
        assert!(find_session_entry_for(&vault, None, "elsewhere", Some("198.51.100.1"), None).is_none());

        // KeePass export: a session's entry gets that session's address.
        assert_eq!(session_url_for_entry_with("session:Server 2", saved).as_deref(), Some("ssh://ops@192.0.2.10:22"));
        assert_eq!(session_url_for_entry_with("192.0.2.10", saved), None);
        assert_eq!(session_url_for_entry_with("session:No Such Session", saved), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_jump_session_gets_a_login_for_each_host_from_the_vault() {
        use super::jump_credentials_for;
        let session = |name: &str, host: &str, user: &str, extra: &[(&str, &str)]| putty_compat::sessions::PuttySession {
            name: name.into(),
            host_name: host.into(),
            port_number: 22,
            user_name: user.into(),
            protocol: "ssh".into(),
            extra: extra.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            ..Default::default()
        };
        let dir = std::env::temp_dir().join(format!("plinky-jump-lookup-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut vault = Vault::create_fast(dir.join("vault.bin"), &throwaway_password()).unwrap();
        vault.set_entry(VaultEntry::new("session:Router", "final-pw"));
        vault.set_entry(VaultEntry::new("jump:Router", "jump-pw"));
        vault.set_entry(VaultEntry::new("session:Bastion", "preset-pw"));
        let none = |_: &str| None;

        // Typed-in jump host: its entry is jump:<session>.
        let router = session("Router", "192.168.1.5", "admin", &[
            ("ProxyMethod", "6"), ("ProxyHost", "10.0.0.1"), ("ProxyPort", "2200"), ("ProxyUsername", "ops"),
        ]);
        let c = jump_credentials_for(&vault, &router, none).unwrap();
        let j = c.jump.unwrap();
        assert_eq!((j.user.as_str(), j.host.as_str(), j.port, j.password.expose_secret()), ("ops", "10.0.0.1", 2200, "jump-pw"));
        let t = c.target.unwrap();
        assert_eq!((t.user.as_str(), t.host.as_str(), t.password.expose_secret()), ("admin", "192.168.1.5", "final-pw"));

        // A saved session as the jump host brings its own host, user and entry.
        let bastion = session("Bastion", "bastion.example", "jumper", &[]);
        let via_preset = session("Router", "192.168.1.5", "admin", &[("ProxyMethod", "6"), ("ProxyHost", "Bastion")]);
        let c = jump_credentials_for(&vault, &via_preset, |n| (n == "Bastion").then(|| bastion.clone())).unwrap();
        let j = c.jump.unwrap();
        assert_eq!((j.user.as_str(), j.host.as_str(), j.password.expose_secret()), ("jumper", "bastion.example", "preset-pw"));

        // No user name for the jump host: plink asks "login as:"; not ours.
        let no_user = session("Router", "192.168.1.5", "admin", &[("ProxyMethod", "6"), ("ProxyHost", "10.0.0.1")]);
        let c = jump_credentials_for(&vault, &no_user, none).unwrap();
        assert!(c.jump.is_none() && c.target.is_some());

        // An entry with only an enable password gives no login: the target
        // device's prompt is left to the user, not answered with "".
        vault.set_entry(VaultEntry::new("session:Router", "").with_enable_secret("en4ble"));
        let c = jump_credentials_for(&vault, &router, none).unwrap();
        assert!(c.jump.is_some() && c.target.is_none());

        // Not a jump session (or another proxy type): the -pwfile path applies.
        assert!(jump_credentials_for(&vault, &session("Router", "h", "u", &[]), none).is_none());
        assert!(jump_credentials_for(&vault, &session("Router", "h", "u", &[("ProxyMethod", "5"), ("ProxyHost", "x")]), none).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_router_jump_connects_to_the_first_device_and_hops_by_command() {
        // NX-OS first, IOS behind it: no tunnel (NX-OS won't forward),
        // plink goes to the NX-OS box and the script types the hop.
        use super::cli_jump_plan;
        use plinky_core::session::expect::Event;
        let session = |extra: &[(&str, &str)]| putty_compat::sessions::PuttySession {
            name: "PE2".into(),
            host_name: "10.1.1.2".into(),
            port_number: 22,
            user_name: "admin".into(),
            protocol: "ssh".into(),
            extra: extra.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            ..Default::default()
        };
        let dir = std::env::temp_dir().join(format!("plinky-cli-jump-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut vault = Vault::create_fast(dir.join("vault.bin"), &throwaway_password()).unwrap();
        vault.set_entry(VaultEntry::new("session:PE2", "ios-pw"));
        vault.set_entry(VaultEntry::new("jump:PE2", "nxos-pw"));
        let none = |_: &str| None;
        let sent = |e: Event| match e { Event::Send { bytes, .. } => Some(String::from_utf8(bytes.to_vec()).unwrap()), _ => None };

        let pe2 = session(&[
            ("PlinkyJumpMode", "cli"), ("ProxyMethod", "0"), ("ProxyHost", "10.0.0.1"),
            ("ProxyUsername", "space"), ("PlinkyJumpCommand", "ssh -l {user} {host}"),
        ]);
        let (hop, mut script) = cli_jump_plan(Some(&vault), &pe2, none).unwrap();
        assert_eq!((hop.hostname.as_str(), hop.port, hop.username.as_deref()), ("10.0.0.1", 22, Some("space")));
        assert_eq!(sent(script.feed(b"| Password: ")).as_deref(), Some("nxos-pw\r"));
        assert_eq!(sent(script.feed(b"\r\nnexus-01# ")).as_deref(), Some("ssh -l admin 10.1.1.2\r"));
        assert_eq!(sent(script.feed(b"Password: ")).as_deref(), Some("ios-pw\r"));

        // Only an enable password for PE2: the hop's password prompt is
        // the user's, and the enable password is never sent as a login.
        vault.set_entry(VaultEntry::new("session:PE2", "").with_enable_secret("pe2-enable"));
        let (_, mut script) = cli_jump_plan(Some(&vault), &pe2, none).unwrap();
        assert_eq!(sent(script.feed(b"| Password: ")).as_deref(), Some("nxos-pw\r"));
        assert_eq!(sent(script.feed(b"\r\nnexus-01# ")).as_deref(), Some("ssh -l admin 10.1.1.2\r"));
        assert_eq!(sent(script.feed(b"Password: ")), None);

        // Locked vault: it still hops, the passwords are the user's.
        let (_, mut script) = cli_jump_plan(None, &session(&[("PlinkyJumpMode", "cli"), ("ProxyHost", "10.0.0.1")]), none).unwrap();
        assert_eq!(sent(script.feed(b"| Password: ")), None);
        assert_eq!(sent(script.feed(b"\r\nnexus-01# ")).as_deref(), Some("ssh admin@10.1.1.2\r"));

        // Tunnel mode or no jump host: not this path.
        assert!(cli_jump_plan(Some(&vault), &session(&[("ProxyMethod", "6"), ("ProxyHost", "10.0.0.1")]), none).is_none());
        assert!(cli_jump_plan(Some(&vault), &session(&[("PlinkyJumpMode", "cli")]), none).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
