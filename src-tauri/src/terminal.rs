//! Terminal sessions: starting, attaching, typing, resizing and closing them, their output on its way to the page, paced pastes, Break, broadcast input, read-only tabs, shell integration and serial ports.

use super::*;

/// Largest message sent to the page at once.
pub(crate) const COALESCE_MAX: usize = 256 * 1024;

/// While output keeps coming, how often a message goes to the page. Under a
/// flood the PTY hands over reads well under 1 KB, and Tauri delivers each
/// small raw message by evaluating a script in the page: measured in the
/// real app, 0.8 KB messages and 7.6 MB/s. Output after a quiet spell -- a
/// keystroke's echo -- still goes at once.
pub(crate) const BATCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(4);

/// Hands a session's output to its page as raw bytes (ADR-006). It was a
/// `Channel<Vec<u8>>`, which Tauri serialises as a JSON number array: a 4 KB
/// read became ~14 KB of text to build here and parse in the page.
pub(crate) fn forward_output(mut rx: mpsc::UnboundedReceiver<Vec<u8>>, on_data: Channel) {
    tokio::spawn(async move {
        let mut last_send: Option<tokio::time::Instant> = None;
        while let Some(mut batch) = rx.recv().await {
            // Busy: gather until an interval has passed since the last send.
            if let Some(deadline) = last_send.map(|t| t + BATCH_INTERVAL) {
                while batch.len() < COALESCE_MAX {
                    match tokio::time::timeout_at(deadline, rx.recv()).await {
                        Ok(Some(more)) => batch.extend_from_slice(&more),
                        _ => break,
                    }
                }
            }
            while batch.len() < COALESCE_MAX {
                match rx.try_recv() {
                    Ok(more) => batch.extend_from_slice(&more),
                    Err(_) => break,
                }
            }
            if on_data.send(InvokeResponseBody::Raw(batch)).is_err() {
                break;
            }
            last_send = Some(tokio::time::Instant::now());
        }
    });
}

/// The page finished drawing `bytes` of a session's output (ADR-006). Async
/// so the stream of acks during a flood stays off the main thread.
#[tauri::command]
pub(crate) async fn ack_terminal_output(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    bytes: u64,
) -> Result<(), String> {
    registry.ack_output(&session_id, bytes);
    Ok(())
}

/// Sessions whose connection is up (watch_connection), for a page that asks
/// after the event already went by.
#[derive(Default)]
pub(crate) struct ConnectedSessions(pub(crate) std::sync::Mutex<std::collections::HashSet<String>>);

/// Tells the page, as `session:connected`, when a session's TCP connection
/// is up: told by the transport for telnet and raw, which Thyrion connects
/// itself, and seen on plink's own socket otherwise (tcp_state.rs). A console that
/// prints nothing until something happens on the device otherwise showed
/// "Connecting to host:port" long after it had connected: measured on a
/// GNS3 IOS console, 0 bytes in the first 5 s. Linux and Windows can tell;
/// where it can't be told the watcher stops at once and the page waits for
/// output, as before.
pub(crate) fn watch_connection(app: &tauri::AppHandle, id: String) {
    let registry = app.state::<Arc<SessionRegistry>>().inner().clone();
    let Some(instance) = registry.instance_of(&id) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // A connect that fails takes the OS's connect timeout; a session
        // can't still be connecting after two minutes.
        let started = tokio::time::Instant::now();
        let deadline = started + std::time::Duration::from_secs(120);
        while tokio::time::Instant::now() < deadline {
            // Closed or restarted under the same id: this watch is over.
            if registry.instance_of(&id) != Some(instance) {
                return;
            }
            // The connect failed (refused, unreachable). A tab behind the
            // front one has no view to hear it, and kept its "connecting"
            // spinner; on Windows the table then showed no rows forever
            // rather than ending this loop.
            if registry.is_session_ended(&id) {
                let _ = app.emit("session:ended", &id);
                return;
            }
            match registry.is_connected(&id) {
                Some(true) => {
                    app.state::<ConnectedSessions>().0.lock().unwrap().insert(id.clone());
                    let _ = app.emit("session:connected", &id);
                    return;
                }
                // Every 10 ms while a connect is still quick; after a second
                // (a slow or unreachable host), every 100 ms: for plink each
                // look reads the system's connection and process tables.
                Some(false) => {
                    let pause = if started.elapsed() < std::time::Duration::from_secs(1) { 10 } else { 100 };
                    tokio::time::sleep(std::time::Duration::from_millis(pause)).await
                }
                None => return,
            }
        }
    });
}

#[tauri::command]
pub(crate) fn is_session_connected(connected: State<'_, ConnectedSessions>, session_id: String) -> bool {
    connected.0.lock().unwrap().contains(&session_id)
}

/// For a page that made its tab after `session:ended` went by: a console
/// refused in milliseconds ends before GNS3's tab exists.
#[tauri::command]
pub(crate) fn is_session_ended(registry: State<'_, Arc<SessionRegistry>>, session_id: String) -> bool {
    registry.is_session_ended(&session_id)
}

/// The tab left the screen. The session keeps running into scrollback and is
/// no longer held to the page's pace; attaching again replays it.
#[tauri::command]
pub(crate) fn detach_terminal_session(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
) -> Result<(), String> {
    registry
        .detach_session(&session_id)
        .map_err(|e| format!("Failed to detach session: {e}"))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn start_terminal_session(
    app: tauri::AppHandle,
    registry: State<'_, Arc<SessionRegistry>>,
    vault_state: State<'_, VaultState>,
    session_id: String,
    session_name: String,
    is_local: bool,
    cols: u16,
    rows: u16,
    on_data: Channel,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    log_file_name: Option<String>,
    // For a target that isn't a saved session: GNS3 consoles are telnet.
    protocol: Option<plinky_core::transport::plink::TargetProtocol>,
    // The tab's title, for filing the automatic log of an unsaved session.
    title: Option<String>,
) -> Result<(), String> {
    let putty_log = if is_local || log_file_name.as_deref().is_some_and(|n| !n.is_empty()) {
        None
    } else {
        putty_compat::sessions::read_session(&session_name)
            .ok()
            .and_then(|s| putty_session_log(&s, unix_now()))
    };
    // A log the session already has (a file given, PuTTY's own setting)
    // comes first; otherwise the automatic one, if it gets one.
    let auto_log = if putty_log.is_some() || log_file_name.as_deref().is_some_and(|n| !n.is_empty()) {
        None
    } else {
        auto_log_for(&app, &session_name, title.as_deref(), is_local)
    };
    let logon = if is_local {
        None
    } else {
        putty_compat::sessions::read_session(&session_name).ok().and_then(|s| logon_script(&s))
    };
    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    forward_output(rx, on_data);
    spawn_terminal_session(
        &registry, &vault_state, session_id.clone(), session_name, is_local, cols, rows, tx,
        hostname, port, username, log_file_name, protocol,
    )
    .await?;
    if let Some(script) = logon {
        let _ = registry.set_logon_actions(&session_id, script);
    }
    if !is_local {
        watch_connection(&app, session_id.clone());
    }
    if let Some((path, mode)) = putty_log {
        // Opened right after the spawn returns: output from the first few
        // milliseconds can reach the page before the log. A log that can't
        // be opened doesn't stop the session.
        if let Err(e) = registry.start_log(&session_id, &path, mode) {
            eprintln!("thyrion: {}", shown(e));
        }
    }
    if let Some((path, mode)) = auto_log {
        // From the session's first byte. A log that can't be opened (a
        // folder that's gone, a full disk) doesn't stop the session.
        if let Err(e) = registry.start_log_from_start(&session_id, &path, mode) {
            eprintln!("thyrion: {}", shown(e));
        }
    }
    Ok(())
}

/// A saved session's logon actions: PlinkyLogonActions, a JSON list of
/// [wait for, send] pairs written by the session settings. Nothing, or
/// anything that doesn't read, means none.
pub(crate) fn logon_script(s: &putty_compat::sessions::PuttySession) -> Option<plinky_core::session::expect::Expect> {
    let raw = s.extra.get("PlinkyLogonActions")?;
    let pairs: Vec<(String, String)> = serde_json::from_str(raw).ok()?;
    plinky_core::session::expect::logon_actions(&pairs)
}

/// Locks a tab read only, or unlocks it (session_manager's input lock).
#[tauri::command]
pub(crate) fn set_session_locked(registry: State<'_, Arc<SessionRegistry>>, session_id: String, locked: bool) {
    registry.set_input_locked(&session_id, locked);
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn spawn_terminal_session(
    registry: &SessionRegistry,
    vault_state: &VaultState,
    session_id: String,
    session_name: String,
    is_local: bool,
    cols: u16,
    rows: u16,
    // Where output goes: the page's channel, or nowhere yet for a console
    // started before its tab exists (start_console_session).
    tx: mpsc::UnboundedSender<Vec<u8>>,
    hostname: Option<String>,
    port: Option<u16>,
    username: Option<String>,
    log_file_name: Option<String>,
    protocol: Option<plinky_core::transport::plink::TargetProtocol>,
) -> Result<(), String> {
    // Saved serial sessions open on the native serial transport (ADR-005):
    // plink can't send a Break. Line settings come from the PuTTY file.
    let saved_serial = (!is_local)
        .then(|| putty_compat::sessions::read_session(&session_name).ok())
        .flatten()
        .filter(|s| s.protocol.eq_ignore_ascii_case("serial"));

    if is_local {
        registry
            .create_local_session(&session_id, &session_name, log_file_name, cols, rows, tx)
            .map_err(|e| format!("Failed to create local session: {e}"))
    } else if let Some(sess) = saved_serial {
        // These messages go straight to the terminal ("Failed to open serial
        // line /dev/ttyUSB0: No such file or directory").
        let config = plinky_core::transport::serial::SerialConfig::from_putty_keys(&sess.extra)
            .map_err(shown)?;
        registry
            .create_serial_session(&session_id, &session_name, &config, log_file_name, tx)
            .map_err(shown)
    } else {
        // Quick Connect and split-pane clones invent a display name that was
        // never saved as a real PuTTY session -- pass the actual host/port/
        // username through so plink has somewhere to connect even when
        // there's no ~/.putty/sessions file to -load.
        // SSH logs in by itself when the vault (unlocked) has this
        // session's password: plink reads it from a file, so it goes only to
        // this host, after its key is checked, and is never typed. Telnet
        // and other plink protocols have no -pwfile.
        let saved = putty_compat::sessions::read_session(&session_name).ok();
        let is_ssh = saved
            .as_ref()
            .map(|s| s.protocol.is_empty() || s.protocol.eq_ignore_ascii_case("ssh"))
            .unwrap_or(protocol.unwrap_or_default() == plinky_core::transport::plink::TargetProtocol::Ssh);
        let has_username = match &saved {
            Some(s) => !s.user_name.is_empty(),
            None => username.as_deref().is_some_and(|u| !u.is_empty()),
        };
        // Through a jump host, plink would offer a -pwfile password to the
        // jump host first; answer each host's prompt instead.
        // Through a router or switch's CLI: plink goes to the first device,
        // a script hops from there (a tunnel is refused by NX-OS and IOS).
        if let Some(s) = saved.as_ref() {
            let guard = vault_state.inner.lock().await;
            let plan = cli_jump_plan(guard.as_ref(), s, |n| putty_compat::sessions::read_session(n).ok());
            drop(guard);
            if let Some((first_hop, script)) = plan {
                // Not the saved name: plink must not -load the target.
                let hop_name = format!("{} (via {})", session_name, first_hop.hostname);
                return registry
                    .create_plink_session_with_script(&session_id, &hop_name, first_hop, script, log_file_name, cols, rows, tx)
                    .map_err(|e| format!("Failed to create plink session: {e}"));
            }
        }
        if is_ssh {
            let guard = vault_state.inner.lock().await;
            let jump = match (guard.as_ref(), saved.as_ref()) {
                (Some(v), Some(s)) => jump_credentials_for(v, s, |n| putty_compat::sessions::read_session(n).ok()),
                (None, Some(s)) if s.extra.get("ProxyMethod").is_some_and(|m| m == "6") => {
                    // Locked vault: no -pwfile either, or the final host's
                    // password could still reach the jump host.
                    Some(plinky_core::session::jump_login::JumpCredentials { jump: None, target: None })
                }
                _ => None,
            };
            drop(guard);
            if let Some(credentials) = jump {
                return registry
                    .create_plink_session_with_jump_login(&session_id, &session_name, credentials, log_file_name, cols, rows, tx)
                    .map_err(|e| format!("Failed to create plink session: {e}"));
            }
        }
        let login = if is_ssh {
            let guard = vault_state.inner.lock().await;
            guard
                .as_ref()
                .and_then(|v| find_session_entry(v, &session_name, hostname.as_deref(), username.as_deref()))
                .filter(|e| e.has_login())
                .map(|e| plinky_core::transport::plink::PlinkLogin {
                    password: e.secret.clone(),
                    username: if has_username { None } else { e.username.clone() },
                })
        } else {
            None
        };
        let explicit_target = hostname
            .filter(|h| !h.is_empty())
            .map(|h| plinky_core::transport::plink::ExplicitTarget {
                hostname: h,
                port: port.unwrap_or(22),
                username,
                protocol: protocol.unwrap_or_default(),
            });
        registry
            .create_plink_session_with_login(&session_id, &session_name, explicit_target, login, log_file_name, cols, rows, tx)
            .map_err(|e| format!("Failed to create plink session: {e}"))
    }
}

#[tauri::command]
pub(crate) fn attach_terminal_session(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    from_seq: usize,
    on_data: Channel,
) -> Result<AttachInfo, String> {
    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    forward_output(rx, on_data);

    registry
        .attach_session(&session_id, tx, from_seq)
        .map_err(|e| format!("Failed to attach session: {e}"))
}

#[tauri::command]
pub(crate) fn answer_hostkey_prompt(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    answer: String,
) -> Result<(), String> {
    let prompt_answer = match answer.as_str() {
        "store" => PromptAnswer::AcceptAndStore,
        "once" => PromptAnswer::AcceptOnce,
        _ => PromptAnswer::Reject,
    };
    registry
        .answer_prompt(&session_id, prompt_answer)
        .map_err(|e| format!("Failed to answer prompt: {e}"))
}

#[tauri::command]
pub(crate) fn write_terminal_input(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    registry
        .write_input(&session_id, &data)
        .map_err(|e| format!("Failed to write input: {e}"))
}

#[tauri::command]
pub(crate) fn resize_terminal(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    registry
        .resize(&session_id, cols, rows)
        .map_err(|e| format!("Failed to resize terminal: {e}"))
}

#[tauri::command]
pub(crate) fn close_terminal_session(
    registry: State<Arc<SessionRegistry>>,
    connected: State<ConnectedSessions>,
    session_id: String,
) -> Result<(), String> {
    connected.0.lock().unwrap().remove(&session_id);
    registry
        .close_session(&session_id)
        .map_err(|e| format!("Failed to close session: {e}"))
}

#[tauri::command]
pub(crate) fn set_sync_channel(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    channel: Option<String>,
) -> Result<(), String> {
    let chan_id = channel.as_deref().and_then(SyncChannelId::parse);
    registry.set_sync_channel(&session_id, chan_id);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_sync_protected(
    registry: State<Arc<SessionRegistry>>,
    session_id: String,
    protected: bool,
) -> Result<(), String> {
    registry.set_sync_protected(&session_id, protected);
    Ok(())
}

#[tauri::command]
pub(crate) fn set_sync_armed(
    registry: State<Arc<SessionRegistry>>,
    armed: bool,
) -> Result<(), String> {
    registry.set_sync_armed(armed);
    Ok(())
}

#[tauri::command]
pub(crate) fn broadcast_sync_input(
    registry: State<Arc<SessionRegistry>>,
    channel: String,
    data: Vec<u8>,
) -> Result<Vec<String>, String> {
    // The recipients' ids, not a count: the UI lights up exactly the panes
    // that received the command (T-012).
    if channel.eq_ignore_ascii_case("all") {
        registry
            .broadcast_sync_all(&data)
            .map_err(|e| format!("Failed to broadcast sync input: {e}"))
    } else {
        let chan_id = SyncChannelId::parse(&channel)
            .ok_or_else(|| format!("Invalid sync channel '{channel}'"))?;
        registry
            .broadcast_sync_input(chan_id, &data)
            .map_err(|e| format!("Failed to broadcast sync input: {e}"))
    }
}

/// Cancel flags for in-flight paced pastes, keyed by session id.
#[derive(Default)]
pub struct PasteJobs(std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::atomic::AtomicBool>>>);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PasteProgress {
    session_id: String,
    sent: usize,
    total: usize,
}

/// Pastes `text` one line at a time with `line_delay_ms` between lines (for
/// console ports and network gear that drop characters on a fast paste).
/// Emits "paste:progress" after each line; resolves with the lines sent.
#[tauri::command]
pub(crate) async fn paste_paced(
    app: tauri::AppHandle,
    registry: State<'_, Arc<SessionRegistry>>,
    jobs: State<'_, PasteJobs>,
    session_id: String,
    text: String,
    line_delay_ms: u64,
) -> Result<usize, String> {
    let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let mut map = jobs.0.lock().unwrap();
        if map.contains_key(&session_id) {
            return Err("A paste is already in progress for this session".into());
        }
        map.insert(session_id.clone(), cancel.clone());
    }
    let result = registry
        .paste_paced(
            &session_id,
            &text,
            std::time::Duration::from_millis(line_delay_ms),
            cancel,
            |sent, total| {
                let _ = app.emit(
                    "paste:progress",
                    PasteProgress { session_id: session_id.clone(), sent, total },
                );
            },
        )
        .await;
    jobs.0.lock().unwrap().remove(&session_id);
    result.map_err(|e| format!("Paste failed: {e}"))
}

#[tauri::command]
pub(crate) fn cancel_paste(jobs: State<'_, PasteJobs>, session_id: String) {
    if let Some(flag) = jobs.0.lock().unwrap().get(&session_id) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Sends a serial Break (ADR-005). 400 ms is what PuTTY holds on Windows and
/// is long enough for Cisco ROMMON and similar. Errors on non-serial sessions.
#[tauri::command]
pub(crate) async fn send_break(registry: State<'_, Arc<SessionRegistry>>, session_id: String) -> Result<(), String> {
    registry
        .send_break(&session_id, std::time::Duration::from_millis(400))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn get_shell_integration_script(shell: String) -> Result<String, String> {
    let shell_type = ShellType::parse(&shell)
        .ok_or_else(|| format!("Unsupported shell: '{shell}'. Expected bash, zsh, or fish."))?;
    Ok(get_bootstrap_script(shell_type).to_string())
}

#[tauri::command]
pub(crate) fn inject_shell_integration(
    registry: State<'_, Arc<SessionRegistry>>,
    session_id: String,
    shell: String,
) -> Result<(), String> {
    let shell_type = ShellType::parse(&shell)
        .ok_or_else(|| format!("Unsupported shell: '{shell}'. Expected bash, zsh, or fish."))?;
    let script = get_bootstrap_script(shell_type);
    // write_input_live_only, NOT write_input: this is a programmatic bulk
    // write, not the user's own keystrokes. Using the looser write_input
    // here previously let the bootstrap script get submitted as a series
    // of password guesses if injected while a session sat at its remote
    // password prompt -- see the doc comment on write_input_live_only.
    registry
        .write_input_live_only(&session_id, script.as_bytes())
        .map_err(|e| format!("Failed to inject shell integration: {e}"))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn list_serial_ports() -> Result<Vec<plinky_core::transport::serial::DetectedSerialPort>, String> {
    off_main(move || {
        Ok(plinky_core::transport::serial::detect_serial_ports())
    }).await?
}
