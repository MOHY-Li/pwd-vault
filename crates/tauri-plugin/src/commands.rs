use pwd_vault_core::audit::{AuditEventType, AuditLog};
use pwd_vault_core::entry::Entry;
use pwd_vault_core::generator::{self, CharSet, GeneratorConfig};
use pwd_vault_core::import_export::{self, ExportFormat, ImportFormat};
use pwd_vault_core::strength;
use pwd_vault_core::totp;
use pwd_vault_core::vault::VaultFile;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

pub struct VaultState(pub Mutex<Option<VaultFile>>);
pub struct VaultPath(pub Mutex<Option<PathBuf>>);
pub struct AuditState(pub Mutex<AuditLog>);

// ---------------------------------------------------------------------------
// Helper: audit log path alongside vault file
// ---------------------------------------------------------------------------

/// Derive the audit log path from the vault file path: `<vault>.audit`
fn audit_path_for_vault(vault_path: &std::path::Path) -> std::path::PathBuf {
    let mut p = vault_path.to_path_buf();
    p.set_extension("vault.audit");
    p
}

/// Persist the audit log to disk (best-effort, errors are logged to stderr).
fn persist_audit(log: &AuditLog, vault_path: &std::path::Path) {
    let audit_path = audit_path_for_vault(vault_path);
    if let Err(e) = log.save_to_file(&audit_path) {
        eprintln!("warning: failed to persist audit log: {e}");
    }
}

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
    audit_state: State<'_, AuditState>,
) -> Result<(), String> {
    let mut vault = VaultFile::create(&master_password).map_err(|e| e.to_string())?;
    let file_path = PathBuf::from(&path);
    vault.save(&file_path).map_err(|e| e.to_string())?;

    *vault_state
        .0
        .lock()
        .map_err(|e| format!("lock error: {e}"))? = Some(vault);
    *vault_path
        .0
        .lock()
        .map_err(|e| format!("lock error: {e}"))? = Some(file_path);

    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::VaultCreated);
    Ok(())
}

#[tauri::command]
pub fn vault_open(
    master_password: String,
    path: String,
    vault_state: State<'_, VaultState>,
    vault_path: State<'_, VaultPath>,
    audit_state: State<'_, AuditState>,
) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    let vault = VaultFile::open(&master_password, &file_path).map_err(|e| e.to_string())?;

    *vault_state
        .0
        .lock()
        .map_err(|e| format!("lock error: {e}"))? = Some(vault);
    *vault_path
        .0
        .lock()
        .map_err(|e| format!("lock error: {e}"))? = Some(file_path.clone());

    // R1: Load persisted audit log if it exists
    let audit_path = audit_path_for_vault(&file_path);
    if audit_path.exists() {
        if let Ok(loaded) = AuditLog::load_from_file(&audit_path) {
            *audit_state.0.lock().map_err(|e| e.to_string())? = loaded;
        }
    }

    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::VaultOpened);
    Ok(())
}

#[tauri::command]
pub fn vault_save(
    vault_state: State<'_, VaultState>,
    vault_path: State<'_, VaultPath>,
    audit_state: State<'_, AuditState>,
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

    vault.save(&file_path).map_err(|e| e.to_string())?;

    // R1: Persist audit log alongside vault file
    {
        let log = audit_state.0.lock().map_err(|e| e.to_string())?;
        persist_audit(&log, &file_path);
    }

    Ok(())
}

#[tauri::command]
pub fn vault_lock(
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    *guard = None;
    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::VaultLocked);
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
pub fn entry_add(
    entry_json: String,
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<String, String> {
    let mut entry: Entry =
        serde_json::from_str(&entry_json).map_err(|e| format!("invalid entry JSON: {e}"))?;

    // Override the id with a server-generated UUID to prevent frontend injection.
    entry.id = uuid::Uuid::new_v4().to_string();

    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    let id = entry.id.clone();
    vault.add_entry(entry);

    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::EntryCreated {
            entry_id: id.clone(),
        });
    Ok(id)
}

#[tauri::command]
pub fn entry_update(
    entry_json: String,
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<(), String> {
    let entry: Entry =
        serde_json::from_str(&entry_json).map_err(|e| format!("invalid entry JSON: {e}"))?;

    let id = entry.id.clone();
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    vault.update_entry(entry).map_err(|e| e.to_string())?;
    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::EntryUpdated { entry_id: id });
    Ok(())
}

#[tauri::command]
pub fn entry_delete(
    id: String,
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    if vault.delete_entry(&id) {
        audit_state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .log(AuditEventType::EntryDeleted { entry_id: id });
        Ok(())
    } else {
        Err(format!("entry not found: {id}"))
    }
}

#[tauri::command]
pub fn entry_get(id: String, vault_state: State<'_, VaultState>) -> Result<Option<String>, String> {
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
pub fn entry_search(query: String, vault_state: State<'_, VaultState>) -> Result<String, String> {
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

// ---------------------------------------------------------------------------
// TOTP commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn totp_generate(
    entry_id: String,
    vault_state: State<'_, VaultState>,
) -> Result<String, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    let entry = vault
        .get_entry(&entry_id)
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;

    let config = entry
        .totp
        .as_ref()
        .ok_or_else(|| format!("entry has no TOTP config: {entry_id}"))?;

    let code = totp::generate_totp(config).map_err(|e| e.to_string())?;
    Ok(code)
}

#[tauri::command]
pub fn totp_time_remaining(
    entry_id: String,
    vault_state: State<'_, VaultState>,
) -> Result<u32, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    let entry = vault
        .get_entry(&entry_id)
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;

    let config = entry
        .totp
        .as_ref()
        .ok_or_else(|| format!("entry has no TOTP config: {entry_id}"))?;

    Ok(totp::time_remaining(config))
}

#[tauri::command]
pub fn totp_parse_uri(uri: String) -> Result<String, String> {
    let config = totp::parse_totp_uri(&uri).map_err(|e| e.to_string())?;
    serde_json::to_string(&config).map_err(|e| format!("serialization error: {e}"))
}

// ---------------------------------------------------------------------------
// Import / Export commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn vault_import(
    format: String,
    data: String,
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<String, String> {
    let import_format = match format.as_str() {
        "json" => ImportFormat::Json,
        "csv" => ImportFormat::Csv,
        "bitwarden_json" => ImportFormat::BitwardenJson,
        "bitwarden_csv" => ImportFormat::BitwardenCsv,
        "onepassword_csv" => ImportFormat::OnePasswordCsv,
        "keepass_xml" => ImportFormat::KeePassXml,
        other => return Err(format!("unknown import format: {other}")),
    };

    let entries =
        import_export::import_entries(&import_format, &data).map_err(|e| e.to_string())?;

    let count = entries.len();
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;

    for mut entry in entries {
        // R4: Assign new UUID to prevent overwriting existing entries
        entry.id = uuid::Uuid::new_v4().to_string();
        vault.add_entry(entry);
    }

    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::DataImported { count });

    Ok(format!("{count}"))
}

#[tauri::command]
pub fn vault_export(
    format: String,
    exclude_passwords: bool,
    vault_state: State<'_, VaultState>,
    audit_state: State<'_, AuditState>,
) -> Result<String, String> {
    let export_format = match format.as_str() {
        "json" => ExportFormat::Json,
        "csv" => ExportFormat::Csv,
        "vault" => ExportFormat::VaultFile,
        other => return Err(format!("unknown export format: {other}")),
    };

    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;

    let result = import_export::export_entries(vault.entries(), &export_format, exclude_passwords)
        .map_err(|e| e.to_string())?;

    audit_state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log(AuditEventType::DataExported);
    Ok(result)
}

#[tauri::command]
pub fn detect_import_format(data: String, filename: Option<String>) -> Result<String, String> {
    let format = import_export::detect_format(&data, filename.as_deref());
    let name = match format {
        ImportFormat::Json => "json",
        ImportFormat::Csv => "csv",
        ImportFormat::BitwardenJson => "bitwarden_json",
        ImportFormat::BitwardenCsv => "bitwarden_csv",
        ImportFormat::OnePasswordCsv => "onepassword_csv",
        ImportFormat::KeePassXml => "keepass_xml",
    };
    Ok(name.to_string())
}

// ---------------------------------------------------------------------------
// Recycle bin commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn trash_list(vault_state: State<'_, VaultState>) -> Result<String, String> {
    let guard = get_vault(&vault_state)?;
    let vault = guard
        .as_ref()
        .ok_or_else(|| "no vault is open".to_string())?;
    serde_json::to_string(vault.list_deleted()).map_err(|e| format!("serialization error: {e}"))
}

#[tauri::command]
pub fn entry_restore(id: String, vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;
    if vault.restore_entry(&id) {
        Ok(())
    } else {
        Err(format!("deleted entry not found: {id}"))
    }
}

#[tauri::command]
pub fn entry_purge(id: String, vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;
    if vault.purge_entry(&id) {
        Ok(())
    } else {
        Err(format!("deleted entry not found: {id}"))
    }
}

#[tauri::command]
pub fn trash_empty(vault_state: State<'_, VaultState>) -> Result<(), String> {
    let mut guard = get_vault(&vault_state)?;
    let vault = guard
        .as_mut()
        .ok_or_else(|| "no vault is open".to_string())?;
    vault.empty_trash();
    Ok(())
}

// ---------------------------------------------------------------------------
// Audit log commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn audit_recent(count: usize, audit_state: State<'_, AuditState>) -> Result<String, String> {
    let log = audit_state.0.lock().map_err(|e| e.to_string())?;
    let entries = log.recent(count);
    serde_json::to_string(entries).map_err(|e| format!("serialization error: {e}"))
}
