//! Moving a Plinky-era install's app data to Thyrion's folders.

use super::*;

/// Identifiers this app had before, newest first: Plinky's (renamed to
/// Thyrion in 0.2.0), and before 17afa6d com.plinky.app (Tauri warns that an
/// identifier ending in ".app" clashes with macOS app bundles). The first
/// launch under the current identifier copies the newest one found, so the
/// vault, snippets, folders, layout and settings come along.
pub(crate) const OLD_IDENTIFIERS: [&str; 2] = ["com.plinky.desktop", "com.plinky.app"];

/// Where Tauri and the webview keep per-identifier folders: the vault
/// (app_data_dir) and the webview's localStorage -- snippets, user folders,
/// tags, layout, Shell Hooks choices.
pub(crate) fn identifier_data_bases() -> Vec<PathBuf> {
    let env_dir = |k: &str| std::env::var_os(k).map(PathBuf::from).filter(|p| p.is_absolute());
    let home = env_dir("HOME");
    let mut bases = Vec::new();
    if cfg!(windows) {
        bases.extend(env_dir("APPDATA")); // app_data_dir
        bases.extend(env_dir("LOCALAPPDATA")); // WebView2 profile
    } else if cfg!(target_os = "macos") {
        if let Some(h) = &home {
            bases.push(h.join("Library/Application Support"));
            bases.push(h.join("Library/WebKit"));
        }
    } else {
        bases.extend(env_dir("XDG_DATA_HOME").or_else(|| home.map(|h| h.join(".local/share"))));
    }
    bases
}

/// Copies `base/old` to `base/new` if only the old folder exists. Without
/// this, the first launch under a new identifier looked like a reset. It
/// copies rather than moves, so an older build still finds its data, and
/// renames into place from a staging folder, so an interrupted copy is
/// retried next launch instead of counting as done.
pub(crate) fn migrate_identifier_dir(base: &std::path::Path, old: &str, new: &str) -> std::io::Result<bool> {
    let (from, to) = (base.join(old), base.join(new));
    if old == new || !from.is_dir() || to.exists() {
        return Ok(false);
    }
    let staging = base.join(format!("{new}.migrating"));
    let _ = std::fs::remove_dir_all(&staging);
    copy_dir_all(&from, &staging)?;
    std::fs::rename(&staging, &to)?;
    Ok(true)
}

/// `migrate_identifier_dir` from the newest of `olds` that has data; the
/// identifier it copied from, if any.
pub(crate) fn migrate_from_any<'a>(base: &std::path::Path, olds: &[&'a str], new: &str) -> std::io::Result<Option<&'a str>> {
    for old in olds {
        if migrate_identifier_dir(base, old, new)? {
            return Ok(Some(old));
        }
        if base.join(new).exists() {
            break; // already there: nothing older may overwrite it
        }
    }
    Ok(None)
}

pub(crate) fn copy_dir_all(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let dest = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), &dest)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("plinky-mig-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn old_identifier_data_is_copied_once_and_left_in_place() {
        let base = scratch("copy");
        let store = base.join("old.id/localstorage");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("tauri_localhost_0.localstorage"), b"snippets").unwrap();

        assert!(migrate_identifier_dir(&base, "old.id", "new.id").unwrap());
        let copied = std::fs::read(base.join("new.id/localstorage/tauri_localhost_0.localstorage")).unwrap();
        assert_eq!(copied, b"snippets");
        assert!(store.exists(), "an older build must still find its data");
        assert!(!base.join("new.id.migrating").exists());

        // Data written under the new identifier is never overwritten later.
        std::fs::write(base.join("new.id/localstorage/tauri_localhost_0.localstorage"), b"newer").unwrap();
        assert!(!migrate_identifier_dir(&base, "old.id", "new.id").unwrap());
        let kept = std::fs::read(base.join("new.id/localstorage/tauri_localhost_0.localstorage")).unwrap();
        assert_eq!(kept, b"newer");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_rename_carries_plinkys_data_over_the_newest_first() {
        // Plinky became Thyrion in 0.2.0 (identifier com.thyrion.desktop): the
        // vault and the page's storage had to come along, from
        // com.plinky.desktop, or for a very old install com.plinky.app.
        let base = scratch("rename");
        for (id, body) in [("com.plinky.desktop", "desktop"), ("com.plinky.app", "app")] {
            std::fs::create_dir_all(base.join(id)).unwrap();
            std::fs::write(base.join(id).join("vault.bin"), body).unwrap();
        }
        assert_eq!(migrate_from_any(&base, &OLD_IDENTIFIERS, "com.thyrion.desktop").unwrap(), Some("com.plinky.desktop"));
        assert_eq!(std::fs::read(base.join("com.thyrion.desktop/vault.bin")).unwrap(), b"desktop");
        // Once there, nothing older is copied over it.
        assert_eq!(migrate_from_any(&base, &OLD_IDENTIFIERS, "com.thyrion.desktop").unwrap(), None);

        let only_oldest = scratch("rename-oldest");
        std::fs::create_dir_all(only_oldest.join("com.plinky.app")).unwrap();
        std::fs::write(only_oldest.join("com.plinky.app/vault.bin"), "app").unwrap();
        assert_eq!(migrate_from_any(&only_oldest, &OLD_IDENTIFIERS, "com.thyrion.desktop").unwrap(), Some("com.plinky.app"));
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&only_oldest);
    }

    #[cfg(unix)]
    #[test]
    fn a_copied_vault_stays_readable_by_its_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let base = scratch("perm");
        std::fs::create_dir_all(base.join("com.plinky.desktop")).unwrap();
        let vault = base.join("com.plinky.desktop/vault.bin");
        std::fs::write(&vault, "x").unwrap();
        std::fs::set_permissions(&vault, std::fs::Permissions::from_mode(0o600)).unwrap();
        migrate_from_any(&base, &OLD_IDENTIFIERS, "com.thyrion.desktop").unwrap();
        let mode = std::fs::metadata(base.join("com.thyrion.desktop/vault.bin")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn nothing_happens_without_old_data() {
        let base = scratch("none");
        assert!(!migrate_identifier_dir(&base, "old.id", "new.id").unwrap());
        assert!(!base.join("new.id").exists());
        let _ = std::fs::remove_dir_all(&base);
    }
}
