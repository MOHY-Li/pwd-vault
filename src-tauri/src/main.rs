#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use pwd_vault_tauri_plugin::commands::*;
use pwd_vault_tauri_plugin::{AuditState, VaultPath, VaultState};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState(Default::default()))
        .manage(VaultPath(Default::default()))
        .manage(AuditState(Default::default()))
        .invoke_handler(tauri::generate_handler![
            vault_create,
            vault_open,
            vault_save,
            vault_lock,
            vault_is_open,
            entry_add,
            entry_update,
            entry_delete,
            entry_get,
            entry_list,
            entry_search,
            generate_password,
            evaluate_strength,
            totp_generate,
            totp_time_remaining,
            totp_parse_uri,
            vault_import,
            vault_export,
            vault_export_file,
            vault_import_file,
            detect_import_format,
            trash_list,
            entry_restore,
            entry_purge,
            trash_empty,
            audit_recent,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
