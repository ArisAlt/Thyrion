// Whether the page runs inside the desktop app (Tauri) or in a plain browser
// preview.

// Check if running inside Tauri runtime
export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window || !!(window as any).isTauri);
};
