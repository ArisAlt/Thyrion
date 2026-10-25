//! Consoles opened from outside: the command line, a second launch, GNS3.

use super::*;

/// Console tabs waiting to be opened (T-020): the first launch's own
/// arguments, then whatever later launches forward. Kept here until the
/// page takes them, rather than sent in an event: GNS3's "open all
/// consoles" starts twenty launches within milliseconds, and the ones that
/// arrive while the page is still loading would reach no listener.
pub(crate) struct OpenRequests(pub(crate) std::sync::Mutex<Vec<cli::OpenRequest>>);

/// Starts a console request's session as soon as the request arrives,
/// before the page has drawn a tab for it; the tab attaches and replays what
/// it printed meanwhile. The connect used to wait on the page: measured
/// against GNS3 consoles, plink connects in 7 ms and PuTTY in ~52, while a
/// Thyrion console took ~260-300 ms, ~100-135 of them after the request had
/// already arrived (a 60 ms batching wait, the tab and terminal being
/// built, an attach attempt, then the start).
pub(crate) async fn start_console_session(app: &tauri::AppHandle, mut req: cli::OpenRequest) -> cli::OpenRequest {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("cli-{millis}-{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let registry = app.state::<Arc<SessionRegistry>>();
    let vault = app.state::<VaultState>();
    // No page yet: output only goes to scrollback, for the tab to replay.
    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    drop(rx);
    let name = req.session_name();
    match spawn_terminal_session(
        &registry, &vault, id.clone(), name.clone(), false, 120, 32, tx,
        Some(req.host.clone()), Some(req.port), req.user.clone(), None, Some(req.protocol),
    )
    .await
    {
        Ok(()) => {
            if let Some((path, mode)) = auto_log_for(app, &name, req.title.as_deref(), false) {
                if let Err(e) = registry.start_log_from_start(&id, &path, mode) {
                    eprintln!("thyrion: {}", shown(e));
                }
            }
            // Free-running into scrollback until a tab attaches.
            let _ = registry.detach_session(&id);
            watch_connection(app, id.clone());
            req.session_id = Some(id);
        }
        // The tab starts it itself then, and shows why it failed.
        Err(e) => eprintln!("thyrion: couldn't start {name}: {e}"),
    }
    req
}

/// Starts each request's session, then queues the requests for the page and
/// nudges it. Queued only once started: a page that took a request while
/// its session was still being created would start a second one.
pub(crate) fn open_console_requests(app: &tauri::AppHandle, requests: Vec<cli::OpenRequest>) {
    if requests.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut started = Vec::with_capacity(requests.len());
        for r in requests {
            started.push(start_console_session(&app, r).await);
        }
        app.state::<OpenRequests>().0.lock().unwrap().extend(started);
        // Only a nudge: the page takes the queue when it hears it, and on
        // its own once it is ready.
        let _ = app.emit("cli:open", ());
    });
}

#[tauri::command]
pub(crate) fn take_open_requests(state: State<OpenRequests>) -> Vec<cli::OpenRequest> {
    std::mem::take(&mut *state.0.lock().unwrap())
}
