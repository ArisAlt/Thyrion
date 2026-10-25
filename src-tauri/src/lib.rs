//! The desktop app: the commands the page calls, and `run()`, which wires
//! them up. The commands live in a module per area; each module says what
//! it covers at its top.

mod cli;
#[cfg(unix)]
mod handoff;
mod scripts;

// The page's commands, by area.
mod putty_store;
mod script_commands;
mod terminal;
mod session_logs;
mod vault;
mod sftp;
mod migration;
mod console_requests;
mod clipboard;

use putty_store::*;
use script_commands::*;
use terminal::*;
use session_logs::*;
use vault::*;
use sftp::*;
use migration::*;
use console_requests::*;
use clipboard::*;

use std::path::PathBuf;
use std::sync::Arc;
use tauri::{ipc::{Channel, InvokeResponseBody}, Emitter, Manager, State};
use tokio::sync::Mutex;
use putty_compat::sessions::PuttySession;
use putty_compat::hostkeys::HostKeyEntry;
use putty_compat::ppk::PpkHeader;
use plinky_core::{
    SessionRegistry, PlinkTransport, PuttyInfo, AttachInfo, PromptAnswer,
    SyncChannelId, PsftpClient, SftpFileEntry, Vault, VaultEntry, VaultEntryMeta,
    ShellType, get_bootstrap_script,
};
use tokio::sync::mpsc;


/// Runs blocking work (the registry, the disk, starting a process) off the
/// main thread. Tauri runs a plain `fn` command on the main thread, which on
/// Windows is also the thread that paints the window: reading every saved
/// session from the registry and starting `where` and `plink -V` froze the
/// window at startup and whenever Settings opened (where the theme is
/// changed). Linux never showed it; there the same work is quick.
async fn off_main<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("background task failed: {e}"))
}

/// WebKitGTK's DMA-BUF renderer, on a machine with no GPU render node.
///
/// On a Linux machine with no `/dev/dri/renderD*` (a VM without GPU
/// passthrough, a remote desktop, a CI runner) WebKitGTK still starts its
/// DMA-BUF renderer, fails to get a GPU ("DRI3 error") and falls back to
/// drawing in software. While it does, about a second after the window
/// opens, the page drew nothing for 650-800 ms, though its scripts and the
/// app's main thread were idle: the first keys typed into a console showed
/// up to 0.8 s late, measured with the device getting them in ~20 ms and
/// the page parsing them in ~1 ms. With the renderer off the stall was
/// gone and the page drew ~57 frames a second instead of ~32. With no GPU
/// there is nothing for that renderer to accelerate, so it is turned off
/// there; a machine with a render node keeps it, and a value already in
/// the environment is the user's and is left alone.
pub fn prepare_webkit_environment() {
    #[cfg(target_os = "linux")]
    {
        const VAR: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";
        if std::env::var_os(VAR).is_none() && !has_gpu_render_node(std::path::Path::new("/dev/dri")) {
            // Called first thing in main, before any other thread exists.
            std::env::set_var(VAR, "1");
        }
    }
}

/// Whether `dri` holds a GPU render node (`renderD128` and on).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn has_gpu_render_node(dri: &std::path::Path) -> bool {
    std::fs::read_dir(dri)
        .map(|entries| entries.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")))
        .unwrap_or(false)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = Arc::new(SessionRegistry::new());
    let reg_for_setup = registry.clone();

    // Before the builder runs: the webview opens its storage when the
    // window is created, which happens ahead of the setup hook.
    let context = tauri::generate_context!();
    for base in identifier_data_bases() {
        match migrate_from_any(&base, &OLD_IDENTIFIERS, &context.config().identifier) {
            Ok(Some(old)) => eprintln!("thyrion: carried data over from {old} in {}", base.display()),
            Ok(None) => {}
            Err(e) => eprintln!("thyrion: couldn't carry data over in {}: {e}", base.display()),
        }
    }

    // Thyrion 0.1.0 for Windows saved sessions as files, which plink.exe never
    // reads: every one failed with "plink: no valid host name provided".
    // Copy them into PuTTY's registry key once, before the session list is
    // first loaded. Nothing already in the registry is overwritten.
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from).filter(|p| p.is_absolute()) {
        let marker = appdata
            .join(&context.config().identifier)
            .join(putty_compat::legacy_import::MARKER_FILE);
        for (dir, report) in putty_compat::legacy_import::import_into_registry(&marker) {
            match report {
                Ok(r) => eprintln!(
                    "thyrion: sessions from {}: {} imported, {} already in the registry, {} failed {:?}",
                    dir.display(), r.imported.len(), r.skipped_existing.len(), r.failed.len(), r.failed
                ),
                Err(e) => eprintln!("thyrion: couldn't read old sessions in {}: {e}", dir.display()),
            }
        }
    }

    let argv: Vec<String> = std::env::args().collect();
    let startup_requests = cli::parse_args(&argv);

    // A console request from GNS3 goes to the Thyrion already running, if
    // there is one, before anything else starts (see handoff.rs).
    #[cfg(unix)]
    let handoff_path = handoff::socket_path(&context.config().identifier);
    #[cfg(unix)]
    if !startup_requests.is_empty() && handoff_path.as_deref().is_some_and(|p| handoff::try_hand_over(p, &argv)) {
        return;
    }

    tauri::Builder::default()
        // First: a second launch (GNS3 runs the console command once per
        // device) hands its arguments to this window as new tabs and exits,
        // instead of opening another Thyrion.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            open_console_requests(app, cli::parse_args(&argv));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(OpenRequests(std::sync::Mutex::new(Vec::new())))
        .manage(registry)
        .manage(VaultState::new())
        .manage(PasteJobs::default())
        .manage(ConnectedSessions::default())
        .manage(scripts::Scripts::default())
        .setup(move |app| {
            // Password files a crash left in the temp folder (see
            // sweep_password_files). Off the main thread: a big temp folder
            // must not hold up the window. A minute's age spares the files
            // of sessions starting right now in another launch.
            std::thread::spawn(|| {
                plinky_core::transport::plink::sweep_password_files(
                    &std::env::temp_dir(),
                    std::time::Duration::from_secs(60),
                );
            });
            // The first launch's own consoles connect while the page loads.
            open_console_requests(app.handle(), startup_requests);
            // No safe socket path (see handoff::socket_path): no handoff,
            // later launches still reach us through the plugin.
            #[cfg(unix)]
            if let Some(path) = handoff_path.clone() {
                let handle = app.handle().clone();
                handoff::listen(path, move |args| {
                    open_console_requests(&handle, cli::parse_args(&args));
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.set_focus();
                    }
                });
            }
            // Every session that ends by itself, for the tab, whether or not
            // its view is on screen (SessionRegistry::subscribe_ended).
            let ended_handle = app.handle().clone();
            let mut ended_rx = reg_for_setup.subscribe_ended();
            tauri::async_runtime::spawn(async move {
                loop {
                    match ended_rx.recv().await {
                        Ok(id) => {
                            let _ = ended_handle.emit("session:ended", &id);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => break,
                    }
                }
            });
            let app_handle = app.handle().clone();
            let mut rx = reg_for_setup.subscribe_prompts();
            // tauri::async_runtime::spawn, NOT tokio::spawn: setup() runs
            // before Tauri's own async runtime context is entered around
            // this closure, so a bare tokio::spawn here panics with "there
            // is no reactor running" on startup. Tauri's wrapper dispatches
            // onto whatever runtime it's actually using instead of assuming
            // an ambient tokio::runtime::Handle is already current.
            tauri::async_runtime::spawn(async move {
                while let Ok(event) = rx.recv().await {
                    let _ = app_handle.emit("session:prompt", &event);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            take_open_requests,
            is_session_connected,
            is_session_ended,
            set_session_locked,
            pick_script_file,
            run_script,
            stop_script,
            read_clipboard_text,
            write_clipboard_text,
            paste_paced,
            cancel_paste,
            send_break,
            putty_detect,
            list_putty_sessions,
            read_putty_session,
            write_putty_session,
            delete_putty_session,
            remove_putty_hostkey,
            pick_ppk_file,
            set_session_folders,
            list_putty_hostkeys,
            inspect_ppk,
            start_terminal_session,
            attach_terminal_session,
            start_session_log,
            get_logging_settings,
            set_logging_settings,
            pick_log_folder,
            stop_session_log,
            session_log_status,
            detach_terminal_session,
            ack_terminal_output,
            answer_hostkey_prompt,
            write_terminal_input,
            resize_terminal,
            close_terminal_session,
            set_sync_channel,
            set_sync_protected,
            set_sync_armed,
            broadcast_sync_input,
            sftp_list,
            sftp_mkdir,
            sftp_rm,
            sftp_rmdir,
            sftp_upload,
            sftp_download,
            sftp_list_local,
            sftp_get_home_dir,
            sftp_home_dir,
            vault_is_initialized,
            vault_is_unlocked,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_get,
            vault_set,
            vault_get_entry,
            vault_send_secret,
            vault_export_kdbx,
            vault_destroy,
            vault_lookup,
            vault_set_entry,
            vault_delete,
            vault_list_keys,
            vault_list_entries_meta,
            get_shell_integration_script,
            inject_shell_integration,
            list_serial_ports
        ])
        .build(context)
        .expect("error while building the Thyrion desktop application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // No plink outlives the window.
                if let Some(registry) = app.try_state::<Arc<SessionRegistry>>() {
                    registry.kill_all();
                }
                // On Windows, dropping the sessions at exit closes each
                // pseudo console, and that can block: the app window went
                // away but the process stayed, and had to be ended from Task
                // Manager. The children are dead; leave without the drops.
                #[cfg(windows)]
                std::process::exit(0);
            }
        });
}

#[cfg(test)]
mod tests {

    /// The page hears the host-key prompt and paste progress through
    /// plugin:event|listen, which Tauri refuses unless a capability grants
    /// it. There was none at all: the refusal was caught and logged to
    /// a console nobody sees, so the trust dialog never appeared and a first
    /// connection to an unknown host sat at "The" for good. Checked against
    /// the release binary: without the file, "Command plugin:event|listen
    /// not allowed by ACL"; with it, listen succeeds.
    #[test]
    fn the_main_window_may_listen_to_backend_events() {
        let cap: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let has = |key: &str, want: &str| {
            cap[key].as_array().is_some_and(|a| a.iter().any(|v| v == want))
        };
        assert!(has("windows", "main"));
        assert!(has("permissions", "core:event:allow-listen"));
        assert!(has("permissions", "core:event:allow-unlisten"));
        // The interface size setting (Settings) calls setZoom on the
        // webview; without this grant it silently does nothing.
        assert!(has("permissions", "core:webview:allow-set-webview-zoom"));
    }

    /// Tauri takes over WebView2's drag and drop for file drops unless the
    /// window turns that off, and then the page's own drag and drop never
    /// starts on Windows. Owner, v0.1.30 on Windows: dragging sessions in
    /// the list and tabs in the tab bar did nothing (the SFTP pane's drag
    /// between panes was dead there too). Thyrion takes no file drops from
    /// the desktop, so nothing is lost.
    #[test]
    fn the_page_handles_its_own_drag_and_drop() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = conf["app"]["windows"].as_array().expect("windows in tauri.conf.json");
        assert!(!windows.is_empty());
        for w in windows {
            assert_eq!(w["dragDropEnabled"], serde_json::Value::Bool(false), "{w}");
        }
    }
    #[test]
    fn a_machine_without_a_gpu_render_node_is_told_apart_from_one_with() {
        let base = std::env::temp_dir().join(format!("thyrion-dri-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let dri = base.join("dri");
        // No /dev/dri at all: a VM or container with no GPU.
        assert!(!crate::has_gpu_render_node(&dri));
        // Only a display node: still nothing to render with.
        std::fs::create_dir(&dri).unwrap();
        std::fs::write(dri.join("card0"), b"").unwrap();
        assert!(!crate::has_gpu_render_node(&dri));
        std::fs::write(dri.join("renderD128"), b"").unwrap();
        assert!(crate::has_gpu_render_node(&dri));
    }
}
