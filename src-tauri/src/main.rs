#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pwd_vault_tauri_plugin::{AuditState, VaultPath, VaultState};

fn main() {
    tauri::Builder::default()
        .plugin(pwd_vault_tauri_plugin::init())
        .manage(VaultState(Default::default()))
        .manage(VaultPath(Default::default()))
        .manage(AuditState(Default::default()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
