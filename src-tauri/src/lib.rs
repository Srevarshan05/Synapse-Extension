use tauri::Manager;

pub mod vault;
pub mod server;
pub mod compiler;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      // Logger setup
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // ── Foundation Bootstrap ─────────────────────────────────────────────
      let app_data_dir = app.path().app_local_data_dir().expect("Failed to locate local app data directory");
      let vault = std::sync::Arc::new(vault::VaultManager::new(&app_data_dir));

      // Initialize SQLite database vault index
      if let Err(e) = vault.init() {
        eprintln!("[Synapse] Fatal: Failed to initialize SQLite Vault: {}", e);
      } else {
        // Spawn the Axum HTTP Loopback server in a tauri async runtime background task
        let server_vault = vault.clone();
        let server_dir = app_data_dir.clone();
        tauri::async_runtime::spawn(async move {
          server::start_server(server_vault, server_dir).await;
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
