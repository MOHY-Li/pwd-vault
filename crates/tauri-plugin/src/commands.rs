use pwd_vault_core::entry::Entry;
use pwd_vault_core::generator::{self, CharSet, GeneratorConfig};
use pwd_vault_core::strength;
use pwd_vault_core::vault::VaultFile;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

pub struct VaultState(pub Mutex<Option<VaultFile>>);
pub struct VaultPath(pub Mutex<Option<PathBuf>>);

// ---------------------------------------------------------------------------
// Helper: get mutable vault reference or error
// ---------------------------------------------------------------------------

fn get_vault(state: &VaultState) -> Result<std::sync::MutexGuard<'_, Option<VaultFile>>, String> {
    state
        .0
        .lock()
        .map_err(|e| format!("failed to lock vault state: {e}"))
}

fn get_path(state: &VaultPath) -> Result<std::sync::MutexGuard<'_, Option<PathBuf>>, String> {
    state
        .0
        .lock()
        .map_err(|e| format!("failed to lock vault path state: {e}"))
}

// ---------------------------------------------------------------------------
// Vault lifecycle commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn vault_create(
    master_password: String,
    path: String,
    vault_state: State<'_, VaultState>,
    vault_path: State<'_, VaultPath>,
) -> Result<(), String> {
    let mut vault = VaultFile::create(&master_password).map_err(|e| e.to_string())?;
    let file_path = PathBuf::from(&path);
    vault.save(&master_password, &file_path).map_err(|e| e.to_string())?;

    *vault_state.0.lock().map_err(|e| format!("lock error: {e}"))? = Some(vault);
    *vault_path.0.lock().map_err(|e| format!("lock error: {e}"))? = Some(file_path);

    Ok(())
}

#[tauri::command]
pub fn vault_open(
    master_password: String,
    path: String,
    vault_state: State<'_, VaultState>,
    vault_path: State<'_, VaultPath>,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    let vault = VaultFile::open(&master_password, &file_path).map_err(|e| e.to_string())?;

    *vault_state.0.lock().map_err(|e| format!("lock error: {e}"))? = Some(vault);
    *vault_path.0.lock().map_err(|e| format!("lock error: {e}"))? = Some(file_path);

    Ok(())
}

#[tauri::command]
pub fn vault_save(
    master_password: String,
    vault_state: State<'_, VaultState>,
    vault_path: State<'_, VaultPath>,
) -> Result<(), String> {
    // Acquire VaultState lock BEFORE VaultPath lock (consistent ordering).
    let mut vault_guard = get_vault(&vault_state)?;
    let vault = vault_guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    let file_path = {
        let path_guard = get_path(&vault_path)?;
        path_guard
            .clone()
            .ok_or_else(|| "no vault path stored; open or create a vault first".to_string())?
    };

    vault.save(&master_password, &file_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn vault_lock(vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub fn vault_is_open(vault_state: State<'_, VaultState>) -> Result<bool, String> {
    let guard = get_vault(&vault_state)?;
    Ok(guard.is_some())
}

// ---------------------------------------------------------------------------
// Entry CRUD commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn entry_add(entry_json: String, vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut entry: Entry =
        serde_json::from_str(&entry_json).map_err(|e| format!("invalid entry JSON: {e}"))?;

    // Override the id with a server-generated UUID to prevent frontend injection.
    entry.id = uuid::Uuid::new_v4().to_string();

    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    vault.add_entry(entry);
    Ok(())
}

#[tauri::command]
pub fn entry_update(entry_json: String, vault_state: State<'_, VaultState>) -> Result<(), String> {
    let entry: Entry =
        serde_json::from_str(&entry_json).map_err(|e| format!("invalid entry JSON: {e}"))?;

    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    vault.update_entry(entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn entry_delete(id: String, vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    if vault.delete_entry(&id) {
        Ok(())
    } else {
        Err(format!("entry not found: {id}"))
    }
}

#[tauri::command]
pub fn entry_get(
    id: String,
    vault_state: State<'_, VaultState>,
) -> Result<Option<String>, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    match vault.get_entry(&id) {
        Some(entry) => Ok(Some(
            serde_json::to_string(&entry).map_err(|e| format!("serialization error: {e}"))?,
        )),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn entry_list(vault_state: State<'_, VaultState>) -> Result<String, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    serde_json::to_string(vault.entries()).map_err(|e| format!("serialization error: {e}"))
}

#[tauri::command]
pub fn entry_search(
    query: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    let results = vault.search_entries(&query);
    serde_json::to_string(&results).map_err(|e| format!("serialization error: {e}"))
}

// ---------------------------------------------------------------------------
// Password generator command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn generate_password(
    style: String,
    length: u32,
    uppercase: bool,
    lowercase: bool,
    digits: bool,
    special: bool,
    exclude_ambiguous: bool,
    separator: String,
    word_count: u32,
) -> Result<String, String> {
    match style.as_str() {
        "random" => {
            let charset = CharSet {
                uppercase,
                lowercase,
                digits,
                special,
                exclude_ambiguous,
                exclude_custom: String::new(),
            };
            let config = GeneratorConfig {
                length: length as usize,
                charset,
            };
            generator::generate_password(&config).map_err(|e| e.to_string())
        }
        "diceware" => {
            let wc = if word_count == 0 { 6 } else { word_count };
            let sep = if separator.is_empty() {
                "-".to_string()
            } else {
                separator
            };
            generator::generate_diceware(wc as usize, &sep).map_err(|e| e.to_string())
        }
        other => Err(format!("unknown password style: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Strength evaluation command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn evaluate_strength(password: String) -> Result<String, String> {
    let report = strength::evaluate_password(&password);
    serde_json::to_string(&report).map_err(|e| format!("serialization error: {e}"))
}
