//! Vault index management — encrypted metadata for all entries.
//!
//! The index stores entry metadata (id, encrypted title, category, tags, file
//! offset/length, timestamps) and folder structure. It is itself encrypted with
//! the Vault Key and serialised as JSON before encryption.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Result, VaultError};

// ---------------------------------------------------------------------------
// VaultIndex
// ---------------------------------------------------------------------------

/// Encrypted index stored inside the .vault file header area.
///
/// Contains enough metadata to list / search / filter entries without
/// decrypting individual entry blobs.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultIndex {
    /// Index format version.
    pub version: u32,
    /// When the vault was first created.
    pub created: DateTime<Utc>,
    /// When the vault (or its index) was last modified.
    pub modified: DateTime<Utc>,
    /// Metadata for every live entry.
    #[serde(default)]
    pub entries: Vec<IndexEntry>,
    /// IDs of soft-deleted entries (kept for dedup and possible restore).
    #[serde(default)]
    pub deleted_ids: Vec<String>,
    /// Serialised soft-deleted entries (encrypted alongside the rest of the index).
    #[serde(default)]
    pub deleted_entries_json: String,
    /// Folder hierarchy.
    #[serde(default)]
    pub folders: Vec<Folder>,
}

// ---------------------------------------------------------------------------
// IndexEntry
// ---------------------------------------------------------------------------

/// Lightweight metadata for a single vault entry inside the index.
///
/// `title_enc` is the Base64-encoded ciphertext of the entry title (encrypted
/// with the Vault Key so that the index can be searched client-side after
/// decryption).  The actual entry data lives at `offset` / `length` in the
/// data section of the .vault file and is encrypted with a per-entry key.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexEntry {
    pub id: String,
    /// Base64-encoded encrypted title (encrypted with Vault Key).
    pub title_enc: String,
    /// Plaintext category tag: "login" | "note" | "card" | "identity".
    pub category: String,
    pub tags: Vec<String>,
    /// Byte offset of the encrypted entry blob in the data section.
    pub offset: u64,
    /// Byte length of the encrypted entry blob (nonce + ciphertext + tag).
    pub length: u32,
    pub favorite: bool,
    pub folder_id: Option<String>,
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Folder
// ---------------------------------------------------------------------------

/// A named folder that can optionally have a parent (nesting).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Folder {
    pub id: String,
    /// Base64-encoded encrypted folder name.
    pub name_enc: String,
    pub parent_id: Option<String>,
}

// ---------------------------------------------------------------------------
// VaultIndex impl
// ---------------------------------------------------------------------------

impl VaultIndex {
    /// Create a fresh, empty index.
    #[must_use]
    pub fn new() -> Self {
        let now = Utc::now();
        Self {
            version: 1,
            created: now,
            modified: now,
            entries: Vec::new(),
            deleted_ids: Vec::new(),
            deleted_entries_json: String::new(),
            folders: Vec::new(),
        }
    }

    /// Touch the modified timestamp.
    pub fn touch(&mut self) {
        self.modified = Utc::now();
    }

    // ----- entry CRUD -----

    /// Add or replace an index entry.  If an entry with the same `id` already
    /// exists it is updated in place.
    pub fn upsert_entry(&mut self, entry: IndexEntry) {
        if let Some(pos) = self.entries.iter().position(|e| e.id == entry.id) {
            self.entries[pos] = entry;
        } else {
            self.entries.push(entry);
        }
        self.touch();
    }

    /// Remove an entry by ID (soft-delete: moves id to `deleted_ids`).
    /// Returns `true` if an entry was actually removed.
    pub fn remove_entry(&mut self, id: &str) -> bool {
        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
            let removed = self.entries.remove(pos);
            if !self.deleted_ids.contains(&removed.id) {
                self.deleted_ids.push(removed.id);
            }
            self.touch();
            true
        } else {
            false
        }
    }

    /// Permanently purge a soft-deleted entry ID (no-op if not in `deleted_ids`).
    pub fn purge_entry(&mut self, id: &str) -> bool {
        let before = self.deleted_ids.len();
        self.deleted_ids.retain(|x| x != id);
        self.deleted_ids.len() < before
    }

    /// Get a reference to an entry by ID.
    #[must_use]
    pub fn get_entry(&self, id: &str) -> Option<&IndexEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Get a mutable reference to an entry by ID.
    pub fn get_entry_mut(&mut self, id: &str) -> Option<&mut IndexEntry> {
        self.entries.iter_mut().find(|e| e.id == id)
    }

    // ----- query helpers -----

    /// Return entries whose decrypted title (provided via `match_fn`) or tags
    /// match the query.  `match_fn` receives a Base64-encoded encrypted title;
    /// the caller should decrypt it first and compare.
    ///
    /// For convenience this also accepts an optional pre-decrypted title map
    /// keyed by entry id.
    pub fn search_entries<F>(&self, query: &str, title_matcher: F) -> Vec<&IndexEntry>
    where
        F: Fn(&str, &str) -> bool,
    {
        let q = query.to_lowercase();
        self.entries
            .iter()
            .filter(|e| {
                // match on tags (plaintext in index)
                if e.tags.iter().any(|t| t.to_lowercase().contains(&q)) {
                    return true;
                }
                // match on category
                if e.category.to_lowercase().contains(&q) {
                    return true;
                }
                // delegate title matching to caller
                if title_matcher(&e.id, &e.title_enc) {
                    return true;
                }
                false
            })
            .collect()
    }

    /// Return all entries of a given category.
    #[must_use]
    pub fn entries_by_category(&self, category: &str) -> Vec<&IndexEntry> {
        self.entries
            .iter()
            .filter(|e| e.category == category)
            .collect()
    }

    /// Return all favorite entries.
    #[must_use]
    pub fn favorites(&self) -> Vec<&IndexEntry> {
        self.entries.iter().filter(|e| e.favorite).collect()
    }

    /// Return entries belonging to a folder.
    #[must_use]
    pub fn entries_by_folder(&self, folder_id: &str) -> Vec<&IndexEntry> {
        self.entries
            .iter()
            .filter(|e| e.folder_id.as_deref() == Some(folder_id))
            .collect()
    }

    /// Number of live entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether the index has zero live entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    // ----- folder CRUD -----

    /// Add a new folder.
    pub fn add_folder(&mut self, folder: Folder) {
        self.folders.push(folder);
        self.touch();
    }

    /// Remove a folder by ID, including all nested sub-folders.
    /// Entries belonging to removed folders are moved to root (no folder).
    pub fn remove_folder(&mut self, id: &str) -> bool {
        // Collect the folder itself plus all descendant folder IDs.
        let mut to_remove = vec![id.to_string()];
        loop {
            let current_set: std::collections::HashSet<&str> =
                to_remove.iter().map(std::string::String::as_str).collect();
            let new_ids: Vec<String> = self
                .folders
                .iter()
                .filter_map(|f| {
                    let pid = f.parent_id.as_deref()?;
                    if current_set.contains(pid) && !current_set.contains(f.id.as_str()) {
                        Some(f.id.clone())
                    } else {
                        None
                    }
                })
                .collect();
            if new_ids.is_empty() {
                break;
            }
            to_remove.extend(new_ids);
        }

        let before = self.folders.len();
        let remove_set: std::collections::HashSet<&str> =
            to_remove.iter().map(std::string::String::as_str).collect();
        self.folders.retain(|f| !remove_set.contains(f.id.as_str()));

        // Move orphaned entries to root
        for e in &mut self.entries {
            if let Some(ref fid) = e.folder_id
                && remove_set.contains(fid.as_str())
            {
                e.folder_id = None;
            }
        }

        if self.folders.len() < before {
            self.touch();
            true
        } else {
            false
        }
    }

    /// Get a reference to a folder by ID.
    #[must_use]
    pub fn get_folder(&self, id: &str) -> Option<&Folder> {
        self.folders.iter().find(|f| f.id == id)
    }

    // ----- (de)serialisation -----

    /// Serialise the index to a JSON byte vector.
    pub fn to_json_bytes(&self) -> Result<Vec<u8>> {
        serde_json::to_vec(self).map_err(|e| VaultError::Serialization(e.to_string()))
    }

    /// Deserialise an index from JSON bytes.
    pub fn from_json_bytes(data: &[u8]) -> Result<Self> {
        serde_json::from_slice(data).map_err(|e| VaultError::Serialization(e.to_string()))
    }
}

impl Default for VaultIndex {
    fn default() -> Self {
        Self::new()
    }
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_entry(id: &str, title_enc: &str, category: &str, tags: &[&str]) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            title_enc: title_enc.to_string(),
            category: category.to_string(),
            tags: tags.iter().map(std::string::ToString::to_string).collect(),
            offset: 0,
            length: 0,
            favorite: false,
            folder_id: None,
            created: Utc::now(),
            modified: Utc::now(),
        }
    }

    #[test]
    fn new_index_is_empty() {
        let idx = VaultIndex::new();
        assert!(idx.is_empty());
        assert_eq!(idx.version, 1);
    }

    #[test]
    fn upsert_and_get_entry() {
        let mut idx = VaultIndex::new();
        let e = make_entry("id-1", "enc-title-1", "login", &["work"]);
        idx.upsert_entry(e);

        assert_eq!(idx.len(), 1);
        let got = idx.get_entry("id-1").unwrap();
        assert_eq!(got.category, "login");

        // update same id
        let e2 = make_entry("id-1", "enc-title-2", "note", &[]);
        idx.upsert_entry(e2);
        assert_eq!(idx.len(), 1);
        assert_eq!(idx.get_entry("id-1").unwrap().category, "note");
    }

    #[test]
    fn remove_entry_soft_deletes() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &[]));

        assert!(idx.remove_entry("id-1"));
        assert!(idx.is_empty());
        assert!(idx.deleted_ids.contains(&"id-1".to_string()));
    }

    #[test]
    fn remove_nonexistent_entry() {
        let mut idx = VaultIndex::new();
        assert!(!idx.remove_entry("no-such-id"));
    }

    #[test]
    fn purge_deleted_entry() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &[]));
        idx.remove_entry("id-1");
        assert!(idx.purge_entry("id-1"));
        assert!(!idx.deleted_ids.contains(&"id-1".to_string()));
    }

    #[test]
    fn search_by_tag() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &["work", "dev"]));
        idx.upsert_entry(make_entry("id-2", "t2", "login", &["personal"]));

        // search always matches title via matcher, but we give a matcher that
        // always returns false so only tag matching is exercised.
        let results = idx.search_entries("work", |_id, _enc| false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "id-1");
    }

    #[test]
    fn search_by_category() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &[]));
        idx.upsert_entry(make_entry("id-2", "t2", "note", &[]));

        let results = idx.search_entries("note", |_id, _enc| false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "id-2");
    }

    #[test]
    fn entries_by_category() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &[]));
        idx.upsert_entry(make_entry("id-2", "t2", "note", &[]));
        idx.upsert_entry(make_entry("id-3", "t3", "login", &[]));

        let logins = idx.entries_by_category("login");
        assert_eq!(logins.len(), 2);
    }

    #[test]
    fn favorites() {
        let mut idx = VaultIndex::new();
        let mut e1 = make_entry("id-1", "t1", "login", &[]);
        e1.favorite = true;
        idx.upsert_entry(e1);
        idx.upsert_entry(make_entry("id-2", "t2", "login", &[]));

        let favs = idx.favorites();
        assert_eq!(favs.len(), 1);
        assert_eq!(favs[0].id, "id-1");
    }

    #[test]
    fn folder_crud() {
        let mut idx = VaultIndex::new();
        let folder = Folder {
            id: "folder-1".to_string(),
            name_enc: "enc-name".to_string(),
            parent_id: None,
        };
        idx.add_folder(folder);
        assert!(idx.get_folder("folder-1").is_some());

        // assign entry to folder
        let mut e = make_entry("id-1", "t1", "login", &[]);
        e.folder_id = Some("folder-1".to_string());
        idx.upsert_entry(e);

        // remove folder -> entries become orphaned
        assert!(idx.remove_folder("folder-1"));
        assert!(idx.get_entry("id-1").unwrap().folder_id.is_none());
    }

    #[test]
    fn remove_folder_cascades_to_nested() {
        let mut idx = VaultIndex::new();

        // root -> child -> grandchild
        idx.add_folder(Folder {
            id: "root".into(),
            name_enc: "r".into(),
            parent_id: None,
        });
        idx.add_folder(Folder {
            id: "child".into(),
            name_enc: "c".into(),
            parent_id: Some("root".into()),
        });
        idx.add_folder(Folder {
            id: "grandchild".into(),
            name_enc: "gc".into(),
            parent_id: Some("child".into()),
        });
        // unrelated folder (should survive)
        idx.add_folder(Folder {
            id: "other".into(),
            name_enc: "o".into(),
            parent_id: None,
        });

        // entries in child and grandchild
        let mut e1 = make_entry("e1", "t1", "login", &[]);
        e1.folder_id = Some("child".into());
        idx.upsert_entry(e1);

        let mut e2 = make_entry("e2", "t2", "login", &[]);
        e2.folder_id = Some("grandchild".into());
        idx.upsert_entry(e2);

        // remove root -> should cascade to child and grandchild
        assert!(idx.remove_folder("root"));
        assert!(idx.get_folder("root").is_none());
        assert!(idx.get_folder("child").is_none());
        assert!(idx.get_folder("grandchild").is_none());
        assert!(idx.get_folder("other").is_some()); // unrelated survives

        // entries moved to root
        assert!(idx.get_entry("e1").unwrap().folder_id.is_none());
        assert!(idx.get_entry("e2").unwrap().folder_id.is_none());
    }

    #[test]
    fn json_roundtrip() {
        let mut idx = VaultIndex::new();
        idx.upsert_entry(make_entry("id-1", "t1", "login", &["tag1"]));
        idx.add_folder(Folder {
            id: "f1".to_string(),
            name_enc: "enc".to_string(),
            parent_id: None,
        });

        let bytes = idx.to_json_bytes().unwrap();
        let back = VaultIndex::from_json_bytes(&bytes).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back.entries[0].id, "id-1");
        assert_eq!(back.folders.len(), 1);
    }
}
