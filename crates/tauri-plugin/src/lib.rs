pub mod commands;

pub use commands::{VaultPath, VaultState};

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("pwd-vault")
        .invoke_handler(tauri::generate_handler![
            commands::vault_create,
            commands::vault_open,
            commands::vault_save,
            commands::vault_lock,
            commands::vault_is_open,
            commands::entry_add,
            commands::entry_update,
            commands::entry_delete,
            commands::entry_get,
            commands::entry_list,
            commands::entry_search,
            commands::generate_password,
            commands::evaluate_strength,
        ])
        .build()
}
