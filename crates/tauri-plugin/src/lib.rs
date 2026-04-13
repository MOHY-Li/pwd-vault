pub mod commands;

pub use commands::{AuditState, VaultPath, VaultState};

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("pwd-vault")
        .invoke_handler(tauri::generate_handler![
            // Vault lifecycle
            commands::vault_create,
            commands::vault_open,
            commands::vault_save,
            commands::vault_lock,
            commands::vault_is_open,
            // Entry CRUD
            commands::entry_add,
            commands::entry_update,
            commands::entry_delete,
            commands::entry_get,
            commands::entry_list,
            commands::entry_search,
            // Password generator
            commands::generate_password,
            commands::evaluate_strength,
            // TOTP
            commands::totp_generate,
            commands::totp_time_remaining,
            commands::totp_parse_uri,
            // Import / Export
            commands::vault_import,
            commands::vault_export,
            commands::detect_import_format,
            // Recycle bin
            commands::trash_list,
            commands::entry_restore,
            commands::entry_purge,
            commands::trash_empty,
            // Audit log
            commands::audit_recent,
        ])
        .build()
}
