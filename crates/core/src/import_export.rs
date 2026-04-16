use crate::entry::{Entry, EntryType};
use crate::error::{Result, VaultError};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Format enums
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub enum ImportFormat {
    Json,
    Csv,
    BitwardenJson,
    BitwardenCsv,
    OnePasswordCsv,
    KeePassXml,
}

#[derive(Clone, Debug)]
pub enum ExportFormat {
    Json,
    Csv,
    // VaultFile export removed — use vault_export_file command for encrypted vault export.
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/// Parse data according to `format` and return a list of entries.
pub fn import_entries(format: &ImportFormat, data: &str) -> Result<Vec<Entry>> {
    match format {
        ImportFormat::Json => import_json(data),
        ImportFormat::Csv => import_csv(data),
        ImportFormat::BitwardenJson => import_bitwarden_json(data),
        ImportFormat::BitwardenCsv => import_bitwarden_csv(data),
        ImportFormat::OnePasswordCsv => import_onepassword_csv(data),
        ImportFormat::KeePassXml => import_keepass_xml(data),
    }
}

/// Import entries from a .vault file using the provided password.
/// Returns all (non-deleted) entries from the source vault.
pub fn import_vault_bytes(password: &str, data: &[u8]) -> Result<Vec<Entry>> {
    let vault = crate::vault::VaultFile::open_from_bytes(password, data)?;
    Ok(vault.entries().to_vec())
}

// ---------------------------------------------------------------------------
// Import deduplication
// ---------------------------------------------------------------------------

/// Result of a deduplicated import operation.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
    pub renamed: usize,
}

impl std::fmt::Display for ImportResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}:{}", self.imported, self.skipped, self.renamed)
    }
}

/// Merge `incoming` entries into `existing`, applying deduplication rules per entry type.
///
/// Returns a list of entries that should be added and an `ImportResult` with statistics.
pub fn deduplicate_import(existing: &[Entry], incoming: Vec<Entry>) -> (Vec<Entry>, ImportResult) {
    let mut to_add = Vec::new();
    let mut skipped = 0usize;
    let mut renamed = 0usize;

    for mut entry in incoming {
        entry.id = uuid::Uuid::new_v4().to_string();

        let duplicate = existing
            .iter()
            .chain(to_add.iter())
            .find(|e| is_exact_duplicate(e, &entry));

        if duplicate.is_some() {
            skipped += 1;
            continue;
        }

        let has_conflict = existing
            .iter()
            .chain(to_add.iter())
            .any(|e| is_partial_conflict(e, &entry));

        if has_conflict {
            // Rename with incrementing suffix
            let base_title = entry.title.clone();
            let mut suffix = 2u32;
            loop {
                let new_title = format!("{base_title} ({suffix})");
                let title_exists = existing
                    .iter()
                    .chain(to_add.iter())
                    .any(|e| e.title == new_title && same_type_and_key(e, &entry));
                if !title_exists {
                    entry.title = new_title;
                    break;
                }
                suffix += 1;
            }
            renamed += 1;
        }

        to_add.push(entry);
    }

    let total_imported = to_add.len();
    (
        to_add,
        ImportResult {
            imported: total_imported - renamed,
            skipped,
            renamed,
        },
    )
}

/// Check if two entries are exact duplicates (all core fields match).
fn is_exact_duplicate(a: &Entry, b: &Entry) -> bool {
    if a.entry_type != b.entry_type {
        return false;
    }
    match a.entry_type {
        EntryType::Login => {
            a.title == b.title
                && a.username == b.username
                && a.url == b.url
                && a.password == b.password
        }
        EntryType::Note => a.title == b.title && a.notes == b.notes,
        EntryType::Card => {
            a.title == b.title && a.username == b.username && a.password == b.password
        }
        EntryType::Identity => {
            a.title == b.title
                && a.username == b.username
                && a.url == b.url
                && a.notes == b.notes
                && a.custom_fields == b.custom_fields
        }
        EntryType::Custom(_) => a.title == b.title && a.notes == b.notes,
    }
}

/// Check if two entries have a partial conflict (same identity key but different content).
fn is_partial_conflict(a: &Entry, b: &Entry) -> bool {
    if a.entry_type != b.entry_type {
        return false;
    }
    match a.entry_type {
        EntryType::Login => a.title == b.title && a.username == b.username && a.url == b.url,
        EntryType::Note => a.title == b.title,
        EntryType::Card => a.title == b.title && a.username == b.username,
        EntryType::Identity => a.title == b.title,
        EntryType::Custom(_) => a.title == b.title,
    }
}

/// Check if two entries share the same type and identity key (for title collision detection).
fn same_type_and_key(a: &Entry, b: &Entry) -> bool {
    is_partial_conflict(a, b)
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Serialise entries into the requested format and return the resulting string.
/// If `exclude_passwords` is true, password fields are replaced with empty strings.
pub fn export_entries(
    entries: &[Entry],
    format: &ExportFormat,
    exclude_passwords: bool,
) -> Result<String> {
    if exclude_passwords {
        // Clone and strip passwords
        let sanitized: Vec<Entry> = entries
            .iter()
            .map(|e| {
                let mut s = e.clone();
                s.password.clear();
                s.password_history.clear();
                s.totp = None;
                s
            })
            .collect();
        match format {
            ExportFormat::Json => export_json(&sanitized),
            ExportFormat::Csv => export_csv(&sanitized),
        }
    } else {
        match format {
            ExportFormat::Json => export_json(entries),
            ExportFormat::Csv => export_csv(entries),
        }
    }
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/// Try to guess the import format from the data and an optional filename hint.
#[must_use]
pub fn detect_format(data: &str, filename: Option<&str>) -> ImportFormat {
    let fname = filename.unwrap_or("").to_lowercase();

    if fname.ends_with(".json") {
        // Bitwarden JSON exports contain an `"items"` key at the top level.
        if data.contains("\"items\"") {
            return ImportFormat::BitwardenJson;
        }
        return ImportFormat::Json;
    }

    if fname.ends_with(".csv") {
        // Bitwarden CSV starts with a header that contains "type,name"
        let header_line = data.lines().next().unwrap_or("");
        if header_line.contains("type,") && header_line.contains("name,") {
            return ImportFormat::BitwardenCsv;
        }
        if header_line.contains("Title,") && header_line.contains("Username,") {
            return ImportFormat::OnePasswordCsv;
        }
        return ImportFormat::Csv;
    }

    if fname.ends_with(".xml") {
        return ImportFormat::KeePassXml;
    }

    // Without a filename hint, try content heuristics.
    let trimmed = data.trim();
    if trimmed.starts_with("<?") || trimmed.starts_with("<KeePass") {
        return ImportFormat::KeePassXml;
    }

    // Default to JSON
    ImportFormat::Json
}

// ===========================================================================
// Private helpers – import
// ===========================================================================

fn import_json(data: &str) -> Result<Vec<Entry>> {
    serde_json::from_str(data).map_err(|e| VaultError::Import(format!("invalid JSON: {e}")))
}

fn import_csv(data: &str) -> Result<Vec<Entry>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(data.as_bytes());

    let mut entries = Vec::new();

    for result in rdr.records() {
        let rec = result.map_err(|e| VaultError::Import(format!("CSV parse error: {e}")))?;

        let title = rec.get(0).unwrap_or("").to_string();
        let url = rec.get(1).unwrap_or("").to_string();
        let username = rec.get(2).unwrap_or("").to_string();
        let password = rec.get(3).unwrap_or("").to_string();
        let notes = rec.get(4).unwrap_or("").to_string();
        let type_str = rec.get(5).unwrap_or("login").to_string();

        let entry_type = match type_str.to_lowercase().as_str() {
            "note" => EntryType::Note,
            "card" => EntryType::Card,
            "identity" => EntryType::Identity,
            _ => EntryType::Login,
        };

        let mut e = Entry::new(title, entry_type);
        e.url = url;
        e.username = username;
        e.password = password;
        e.notes = notes;
        entries.push(e);
    }

    Ok(entries)
}

fn import_bitwarden_json(data: &str) -> Result<Vec<Entry>> {
    // Top-level object has an "items" array.  Each item has "type" (1=login,
    // 2=secureNote, 3=card) and a "name".  Login items have a "login" object.
    let parsed: serde_json::Value =
        serde_json::from_str(data).map_err(|e| VaultError::Import(format!("invalid JSON: {e}")))?;

    let items = parsed
        .get("items")
        .ok_or_else(|| VaultError::Import("Bitwarden JSON missing 'items' key".into()))?
        .as_array()
        .ok_or_else(|| VaultError::Import("'items' is not an array".into()))?;

    let mut entries = Vec::new();

    for item in items {
        let name = item["name"].as_str().unwrap_or("").to_string();
        let bw_type = item["type"].as_u64().unwrap_or(1);

        let entry_type = match bw_type {
            2 => EntryType::Note,
            3 => EntryType::Card,
            _ => EntryType::Login,
        };

        let mut e = Entry::new(name, entry_type);

        // login fields
        if let Some(login) = item.get("login") {
            e.username = login["username"].as_str().unwrap_or("").to_string();
            e.password = login["password"].as_str().unwrap_or("").to_string();
            if let Some(uris) = login.get("uris").and_then(|u| u.as_array()) {
                #[allow(clippy::collapsible_if)]
                if let Some(first_uri) = uris.first() {
                    e.url = first_uri["uri"].as_str().unwrap_or("").to_string();
                }
            }
        }

        e.notes = item["notes"].as_str().unwrap_or("").to_string();

        // folder
        if let Some(folder) = item.get("folderName").and_then(|f| f.as_str()) {
            #[allow(clippy::collapsible_if)]
            if !folder.is_empty() {
                e.folder = Some(folder.to_string());
            }
        }

        // favorite
        if let Some(fav) = item.get("favorite").and_then(serde_json::Value::as_bool) {
            e.favorite = fav;
        }

        entries.push(e);
    }

    Ok(entries)
}

fn import_bitwarden_csv(data: &str) -> Result<Vec<Entry>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(data.as_bytes());

    let mut entries = Vec::new();

    for result in rdr.records() {
        let rec = result.map_err(|e| VaultError::Import(format!("CSV parse error: {e}")))?;

        // type,name,login_username,login_password,login_uri,notes
        let type_str = rec.get(0).unwrap_or("1").to_string();
        let name = rec.get(1).unwrap_or("").to_string();
        let username = rec.get(2).unwrap_or("").to_string();
        let password = rec.get(3).unwrap_or("").to_string();
        let uri = rec.get(4).unwrap_or("").to_string();
        let notes = rec.get(5).unwrap_or("").to_string();

        let entry_type = match type_str.as_str() {
            "2" => EntryType::Note,
            "3" => EntryType::Card,
            _ => EntryType::Login,
        };

        let mut e = Entry::new(name, entry_type);
        e.username = username;
        e.password = password;
        e.url = uri;
        e.notes = notes;
        entries.push(e);
    }

    Ok(entries)
}

fn import_onepassword_csv(data: &str) -> Result<Vec<Entry>> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(data.as_bytes());

    let mut entries = Vec::new();

    for result in rdr.records() {
        let rec = result.map_err(|e| VaultError::Import(format!("CSV parse error: {e}")))?;

        // Title,Username,Password,URL,Notes
        let title = rec.get(0).unwrap_or("").to_string();
        let username = rec.get(1).unwrap_or("").to_string();
        let password = rec.get(2).unwrap_or("").to_string();
        let url = rec.get(3).unwrap_or("").to_string();
        let notes = rec.get(4).unwrap_or("").to_string();

        let mut e = Entry::new(title, EntryType::Login);
        e.username = username;
        e.password = password;
        e.url = url;
        e.notes = notes;
        entries.push(e);
    }

    Ok(entries)
}

fn import_keepass_xml(data: &str) -> Result<Vec<Entry>> {
    // Minimal hand-rolled parsing — avoids adding an XML parser dependency.
    // We look for <Entry> blocks and use stateful parsing: track the last
    // <Key> value seen, and when <Value> is encountered, assign it to the
    // corresponding field.
    let mut entries = Vec::new();
    let mut title = String::new();
    let mut username = String::new();
    let mut password = String::new();
    let mut url = String::new();
    let mut notes = String::new();
    let mut in_entry = false;
    let mut current_key: Option<String> = None;

    for line in data.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("<Entry") || trimmed == "<Entry>" {
            in_entry = true;
            title.clear();
            username.clear();
            password.clear();
            url.clear();
            notes.clear();
            current_key = None;
            continue;
        }

        if in_entry && (trimmed.starts_with("</Entry>") || trimmed == "</Entry>") {
            in_entry = false;
            current_key = None;
            let mut e = Entry::new(title.clone(), EntryType::Login);
            e.username.clone_from(&username);
            e.password.clone_from(&password);
            e.url.clone_from(&url);
            e.notes.clone_from(&notes);
            entries.push(e);
            continue;
        }

        if in_entry {
            // Track the last <Key>...</Key> value seen
            if let Some(key) = extract_xml_text(trimmed, "Key") {
                current_key = Some(key);
                continue;
            }

            // When we see <Value>...</Value>, assign based on current_key
            if let Some(val) = extract_xml_text(trimmed, "Value") {
                if let Some(ref key) = current_key {
                    match key.as_str() {
                        "UserName" => username = val,
                        "Password" => password = val,
                        "Title" => title = val,
                        "URL" => url = val,
                        "Notes" => notes = val,
                        _ => {} // ignore unknown keys
                    }
                }
                current_key = None;
            }
        }
    }

    if entries.is_empty() {
        return Err(VaultError::Import("No KeePass entries found in XML".into()));
    }

    Ok(entries)
}

/// Extract the text content from an XML tag like `<Tag>content</Tag>`.
/// Handles opening tags with attributes, e.g. `<Value ProtectInMemory="True">secret</Value>`.
fn extract_xml_text(line: &str, tag: &str) -> Option<String> {
    let open_start = format!("<{tag}");
    let close = format!("</{tag}>");
    if let Some(start) = line.find(&open_start) {
        // Find the closing '>' of the opening tag (may have attributes)
        let tag_end = line[start..].find('>')?;
        let content_start = start + tag_end + 1;
        if let Some(end) = line[content_start..].find(&close) {
            return Some(line[content_start..content_start + end].to_string());
        }
    }
    None
}

// ===========================================================================
// Private helpers – export
// ===========================================================================

fn export_json(entries: &[Entry]) -> Result<String> {
    serde_json::to_string_pretty(entries)
        .map_err(|e| VaultError::Export(format!("JSON serialisation failed: {e}")))
}

fn export_csv(entries: &[Entry]) -> Result<String> {
    let mut wtr = csv::Writer::from_writer(Vec::new());

    // header
    wtr.write_record([
        "title", "url", "username", "password", "notes", "type", "favorite", "tags",
    ])
    .map_err(|e| VaultError::Export(format!("CSV write error: {e}")))?;

    for e in entries {
        let type_str = e.entry_type.as_str();
        let tags = e.tags.join(";");
        let favorite_str = if e.favorite { "true" } else { "false" };
        wtr.write_record([
            &e.title,
            &e.url,
            &e.username,
            &e.password,
            &e.notes,
            type_str,
            favorite_str,
            &tags,
        ])
        .map_err(|err| VaultError::Export(format!("CSV write error: {err}")))?;
    }

    let bytes = wtr
        .into_inner()
        .map_err(|e| VaultError::Export(format!("CSV flush error: {e}")))?;
    String::from_utf8(bytes).map_err(|e| VaultError::Export(format!("CSV utf8 error: {e}")))
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::EntryType;

    fn sample_entry() -> Entry {
        let mut e = Entry::new("Test Site".into(), EntryType::Login);
        e.url = "https://example.com".into();
        e.username = "alice".into();
        e.password = "s3cret".into();
        e.notes = "my notes".into();
        e.favorite = true;
        e.tags = vec!["work".into()];
        e
    }

    #[test]
    fn test_json_roundtrip() {
        let entries = vec![sample_entry()];
        let exported = export_entries(&entries, &ExportFormat::Json, false).unwrap();
        let imported = import_entries(&ImportFormat::Json, &exported).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].title, "Test Site");
        assert_eq!(imported[0].username, "alice");
        assert_eq!(imported[0].password, "s3cret");
        assert_eq!(imported[0].url, "https://example.com");
        assert_eq!(imported[0].notes, "my notes");
    }

    #[test]
    fn test_csv_export_import() {
        let entries = vec![sample_entry()];
        let exported = export_entries(&entries, &ExportFormat::Csv, false).unwrap();
        let imported = import_entries(&ImportFormat::Csv, &exported).unwrap();
        assert_eq!(imported.len(), 1);
        assert_eq!(imported[0].title, "Test Site");
        assert_eq!(imported[0].username, "alice");
        assert_eq!(imported[0].password, "s3cret");
        assert_eq!(imported[0].url, "https://example.com");
        assert_eq!(imported[0].notes, "my notes");
    }

    #[test]
    fn test_detect_format_json() {
        assert!(matches!(
            detect_format("[]", Some("data.json")),
            ImportFormat::Json
        ));
        assert!(matches!(
            detect_format("{\"items\":[]}", Some("bw.json")),
            ImportFormat::BitwardenJson
        ));
    }

    #[test]
    fn test_detect_format_csv() {
        assert!(matches!(
            detect_format("title,url,username,password,notes,type\n", Some("data.csv")),
            ImportFormat::Csv
        ));
        assert!(matches!(
            detect_format(
                "type,name,login_username,login_password,login_uri,notes\n",
                Some("bw.csv")
            ),
            ImportFormat::BitwardenCsv
        ));
    }

    #[test]
    fn test_detect_format_xml() {
        assert!(matches!(
            detect_format("<?xml version=\"1.0\"?>", Some("keepass.xml")),
            ImportFormat::KeePassXml
        ));
    }
}
