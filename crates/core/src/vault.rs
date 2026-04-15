//! Vault binary file format (.vault) — read / write / modify.
//!
//! Layout (see PLAN.md §5.1):
//!
//! ```text
//! [Header: magic + version + flags + argon2 params + salt + auth_hash]
//! [Index Nonce: 24 bytes]
//! [Encrypted Index: variable (XChaCha20-Poly1305 ciphertext + 16-byte tag)]
//! [Entry Data Section: repeating (4B length + 24B nonce + ciphertext + 16B tag)]
//! [File MAC: 32 bytes BLAKE3]
//! ```

use std::io::{Cursor, Read, Write};

use crate::crypto::{
    EncryptedData, MasterKey, compute_mac, decrypt, derive_auth_hash, derive_entry_key,
    derive_mac_key, derive_master_key, derive_vault_key, encrypt, generate_salt,
    verify_and_derive_key, verify_mac,
};
use crate::entry::Entry;
use crate::error::{Result, VaultError};
use crate::vault_index::{IndexEntry, VaultIndex};
use base64::Engine;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Magic bytes identifying a .vault file.
const MAGIC: &[u8; 4] = b"VLT1";
/// Current format version.
const VERSION: u8 = 0x01;
/// Reserved flags byte (always 0x00 for now).
const FLAGS: u8 = 0x00;
/// Default Argon2id memory in MiB.
const DEFAULT_ARGON2_MEMORY_MIB: u32 = 256;
/// Default Argon2id iterations.
const DEFAULT_ARGON2_ITERATIONS: u16 = 4;
/// Default Argon2id parallelism.
const DEFAULT_ARGON2_PARALLELISM: u8 = 4;

/// Byte size of the fixed header (before encrypted index).
/// magic(4) + version(1) + flags(1) + memory(4) + iterations(2) +
/// parallelism(1) + salt(32) + `auth_hash(32)` = 77
#[allow(dead_code)]
const HEADER_SIZE: usize = 77;

// ---------------------------------------------------------------------------
// VaultFile — high-level API
// ---------------------------------------------------------------------------

/// An opened vault that holds the decrypted index and decrypted entries in
/// memory.  Created via [`VaultFile::create`] or [`VaultFile::open`].
pub struct VaultFile {
    /// Cached master key — avoids re-running Argon2 on every save.
    master_key: MasterKey,
    /// Argon2id parameters used for key derivation.
    pub argon2_memory_mib: u32,
    pub argon2_iterations: u16,
    pub argon2_parallelism: u8,
    /// Random salt stored in the file header.
    pub salt: [u8; 32],
    /// The decrypted index (entry metadata + folders).
    pub index: VaultIndex,
    /// Decrypted live entries.
    entries: Vec<Entry>,
    /// Soft-deleted entries kept for recycle bin.
    deleted_entries: Vec<Entry>,
}

impl std::fmt::Debug for VaultFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaultFile")
            .field("argon2_memory_mib", &self.argon2_memory_mib)
            .field("argon2_iterations", &self.argon2_iterations)
            .field("argon2_parallelism", &self.argon2_parallelism)
            .field("salt", &"[..]")
            .field("index", &self.index)
            .field("entries", &self.entries.len())
            .field("deleted_entries", &self.deleted_entries.len())
            .finish_non_exhaustive()
    }
}

impl VaultFile {
    // -----------------------------------------------------------------------
    // Create / Open
    // -----------------------------------------------------------------------

    /// Create a brand-new vault with the given master password.
    /// Returns a `VaultFile` with an empty index and no entries.
    pub fn create(master_password: &str) -> Result<Self> {
        let salt = generate_salt();
        let master_key = derive_master_key(
            master_password,
            &salt,
            DEFAULT_ARGON2_MEMORY_MIB,
            DEFAULT_ARGON2_ITERATIONS,
            u32::from(DEFAULT_ARGON2_PARALLELISM),
        )?;

        Ok(Self {
            master_key,
            argon2_memory_mib: DEFAULT_ARGON2_MEMORY_MIB,
            argon2_iterations: DEFAULT_ARGON2_ITERATIONS,
            argon2_parallelism: DEFAULT_ARGON2_PARALLELISM,
            salt,
            index: VaultIndex::new(),
            entries: Vec::new(),
            deleted_entries: Vec::new(),
        })
    }

    /// Open and decrypt an existing .vault file.
    pub fn open(master_password: &str, path: &std::path::Path) -> Result<Self> {
        let data = std::fs::read(path)?;
        let mut cursor = Cursor::new(&data[..]);

        // --- read header ---
        let mut magic_buf = [0u8; 4];
        cursor.read_exact(&mut magic_buf)?;
        if &magic_buf != MAGIC {
            return Err(VaultError::VaultCorrupted("invalid magic bytes".into()));
        }

        let version = read_u8(&mut cursor)?;
        if version > VERSION {
            return Err(VaultError::VaultCorrupted(format!(
                "unsupported vault version: {version}"
            )));
        }
        let _flags = read_u8(&mut cursor)?;

        let argon2_memory_mib = read_u32_le(&mut cursor)?;
        let argon2_iterations = read_u16_le(&mut cursor)?;
        let argon2_parallelism = read_u8(&mut cursor)?;

        let mut salt = [0u8; 32];
        cursor.read_exact(&mut salt)?;

        let mut stored_auth_hash = [0u8; 32];
        cursor.read_exact(&mut stored_auth_hash)?;

        // --- verify password & derive master key in ONE Argon2 pass ---
        let master_key = verify_and_derive_key(
            master_password,
            &salt,
            &stored_auth_hash,
            argon2_memory_mib,
            argon2_iterations,
            u32::from(argon2_parallelism),
        )?;
        let vault_key = derive_vault_key(&master_key);
        let entry_key_seed = derive_entry_key_seed(master_key.as_bytes());

        // --- decrypt index ---
        let mut index_nonce = [0u8; 24];
        cursor.read_exact(&mut index_nonce)?;

        // The rest of the file until the last 32 bytes is: encrypted_index + entry_data
        let _current_pos = cursor.position() as usize;
        let file_mac_pos = data.len() - 32;

        // Verify file MAC first (covers everything except the MAC itself)
        let mac_key = derive_mac_key(&master_key);
        let stored_mac: &[u8] = &data[file_mac_pos..];
        let mut expected_mac_arr = [0u8; 32];
        expected_mac_arr.copy_from_slice(stored_mac);
        if !verify_mac(&data[..file_mac_pos], &expected_mac_arr, &mac_key) {
            return Err(VaultError::VaultCorrupted(
                "file MAC verification failed".into(),
            ));
        }

        // Now we need to figure out where the encrypted index ends and entry data begins.
        // The index is a single XChaCha20-Poly1305 encrypted blob.
        // Encrypted index starts at current_pos (after the nonce).
        // We don't know its length ahead of time, so we parse:
        //   encrypted_index_data = data[current_pos .. entry_data_start]
        //   entry_data_start is determined by the index itself after decryption.
        //
        // Strategy: try decrypting from current_pos using growing slices until
        // valid JSON is obtained.  Since XChaCha20-Poly1305 produces ciphertext
        // of the same length as plaintext + 16 bytes tag, and the JSON index
        // has a known structure, this works.  But a more robust approach: store
        // the encrypted index length explicitly.
        //
        // Actually, let's store a 4-byte LE length prefix before the encrypted
        // index for easier parsing.

        // Re-read: our format has index_nonce followed by 4-byte index_ciphertext_len
        // then the ciphertext bytes.
        let index_ciphertext_len = read_u32_le(&mut cursor)? as usize;
        let index_ciphertext_start = cursor.position() as usize;

        // Validate bounds
        if index_ciphertext_start + index_ciphertext_len > file_mac_pos {
            return Err(VaultError::VaultCorrupted(
                "index ciphertext overflows into MAC area".into(),
            ));
        }

        let index_encrypted = EncryptedData {
            nonce: index_nonce,
            ciphertext: data[index_ciphertext_start..index_ciphertext_start + index_ciphertext_len]
                .to_vec(),
        };

        let index_bytes = decrypt(&index_encrypted, &vault_key)?;
        let index = VaultIndex::from_json_bytes(&index_bytes)?;

        // --- decrypt entries ---
        let entry_data_start = index_ciphertext_start + index_ciphertext_len;
        let mut entries = Vec::new();
        let mut pos = entry_data_start;

        for idx_entry in &index.entries {
            if pos + 4 > file_mac_pos {
                return Err(VaultError::VaultCorrupted(
                    "unexpected end of entry data".into(),
                ));
            }

            let entry_blob_len =
                u32::from_le_bytes(data[pos..pos + 4].try_into().unwrap()) as usize;
            pos += 4;

            if pos + entry_blob_len > file_mac_pos {
                return Err(VaultError::VaultCorrupted(
                    "entry blob overflows into MAC area".into(),
                ));
            }

            let entry_nonce: [u8; 24] = data[pos..pos + 24].try_into().unwrap();
            let entry_ciphertext = data[pos + 24..pos + entry_blob_len].to_vec();
            pos += entry_blob_len;

            let entry_encrypted = EncryptedData {
                nonce: entry_nonce,
                ciphertext: entry_ciphertext,
            };

            let entry_key = derive_entry_key(&entry_key_seed, idx_entry.id.as_bytes());
            let entry_bytes = decrypt(&entry_encrypted, &entry_key)?;
            let entry: Entry = serde_json::from_slice(&entry_bytes)
                .map_err(|e| VaultError::VaultCorrupted(format!("entry deserialize: {e}")))?;
            entries.push(entry);
        }

        let deleted_entries: Vec<Entry> = if index.deleted_entries_json.is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&index.deleted_entries_json).unwrap_or_default()
        };

        Ok(Self {
            master_key,
            argon2_memory_mib,
            argon2_iterations,
            argon2_parallelism,
            salt,
            index,
            entries,
            deleted_entries,
        })
    }

    // -----------------------------------------------------------------------
    // Save
    // -----------------------------------------------------------------------

    /// Save the vault to disk, re-encrypting everything.
    /// Uses the cached master key — no Argon2 re-derivation needed.
    pub fn save(&mut self, path: &std::path::Path) -> Result<()> {
        let vault_key = derive_vault_key(&self.master_key);
        let entry_key_seed = derive_entry_key_seed(self.master_key.as_bytes());

        // === Phase 1: encrypt all entries and compute offsets ===
        // Work on a cloned index to avoid corrupting self.index on save failure.
        let mut index_work = self.index.clone();
        index_work.deleted_entries_json = serde_json::to_string(&self.deleted_entries)
            .map_err(|e| VaultError::Serialization(e.to_string()))?;

        let mut entry_blobs: Vec<Vec<u8>> = Vec::new();
        let mut offset_accumulator: u64 = 0;

        for idx_entry in &mut index_work.entries {
            let entry = self
                .entries
                .iter()
                .find(|e| e.id == idx_entry.id)
                .ok_or_else(|| VaultError::EntryNotFound(idx_entry.id.clone()))?;

            let entry_json =
                serde_json::to_vec(entry).map_err(|e| VaultError::Serialization(e.to_string()))?;
            let entry_key = derive_entry_key(&entry_key_seed, entry.id.as_bytes());
            let encrypted_entry = encrypt(&entry_json, &entry_key)?;

            let blob_len = 24 + encrypted_entry.ciphertext.len();
            // Build the raw blob: [4-byte blob_len] [nonce] [ciphertext]
            let mut blob = Vec::with_capacity(4 + blob_len);
            blob.extend_from_slice(&(blob_len as u32).to_le_bytes());
            blob.extend_from_slice(&encrypted_entry.nonce);
            blob.extend_from_slice(&encrypted_entry.ciphertext);

            // Record offset (relative to data section start, will be finalized below)
            idx_entry.offset = offset_accumulator;
            idx_entry.length = blob_len as u32;
            offset_accumulator += blob.len() as u64;

            entry_blobs.push(blob);
        }
        // Iterate until encrypted index size converges (offset fixup can grow the JSON).
        let mut encrypted_index = encrypt(&[], &vault_key)?; // placeholder, overwritten in loop
        let relative_offsets: Vec<u64> = index_work.entries.iter().map(|e| e.offset).collect();
        let mut prev_ct_len = 0usize;
        let mut max_iters = 20;
        loop {
            max_iters -= 1;
            if max_iters == 0 {
                break; // Accept last computed offsets even if not fully converged
            }
            // Restore relative offsets
            for (i, idx_entry) in index_work.entries.iter_mut().enumerate() {
                idx_entry.offset = relative_offsets[i];
            }
            let index_bytes = index_work.to_json_bytes()?;
            encrypted_index = encrypt(&index_bytes, &vault_key)?;
            let data_section_start: u64 = 77 + 24 + 4 + encrypted_index.ciphertext.len() as u64;

            // Apply absolute offsets
            for idx_entry in &mut index_work.entries {
                idx_entry.offset += data_section_start;
            }
            // Serialize with absolute offsets
            let index_bytes_abs = index_work.to_json_bytes()?;
            encrypted_index = encrypt(&index_bytes_abs, &vault_key)?;

            if encrypted_index.ciphertext.len() == prev_ct_len {
                break;
            }
            prev_ct_len = encrypted_index.ciphertext.len();
            // Loop again: prev_ct_len now reflects the absolute-offset index size,
            // so the next iteration's data_section_start will be based on a matching size.
        }

        // === Phase 3: assemble final buffer ===
        let mut buf = Vec::new();

        // --- header ---
        buf.write_all(MAGIC)?;
        buf.push(VERSION);
        buf.push(FLAGS);
        buf.extend_from_slice(&self.argon2_memory_mib.to_le_bytes());
        buf.extend_from_slice(&self.argon2_iterations.to_le_bytes());
        buf.push(self.argon2_parallelism);
        buf.extend_from_slice(&self.salt);

        let auth_hash = derive_auth_hash(&self.master_key);
        buf.extend_from_slice(&auth_hash);

        // --- encrypted index ---
        buf.extend_from_slice(&encrypted_index.nonce);
        let idx_ct_len = encrypted_index.ciphertext.len() as u32;
        buf.extend_from_slice(&idx_ct_len.to_le_bytes());
        buf.extend_from_slice(&encrypted_index.ciphertext);

        // --- entry data section ---
        for blob in &entry_blobs {
            buf.extend_from_slice(blob);
        }

        // --- file MAC ---
        let mac_key = derive_mac_key(&self.master_key);
        let mac = compute_mac(&buf, &mac_key);
        buf.extend_from_slice(&mac);

        // Atomic write: write to temp file then rename
        let tmp_path = path.with_extension("vault.tmp");
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        {
            let mut f = std::fs::File::create(&tmp_path)?;
            f.write_all(&buf)?;
            f.sync_all()?;
        }

        // Commit index_work back to self.index only after file write succeeds
        self.index = index_work;

        std::fs::rename(&tmp_path, path)?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Entry CRUD (in-memory)
    // -----------------------------------------------------------------------

    /// Add a new entry.  The entry is stored in memory; call `save()` to persist.
    pub fn add_entry(&mut self, entry: Entry) {
        let id = entry.id.clone();
        let title = entry.title.clone();
        let entry_type_str = match entry.entry_type {
            crate::entry::EntryType::Login => "login",
            crate::entry::EntryType::Note => "note",
            crate::entry::EntryType::Card => "card",
            crate::entry::EntryType::Identity => "identity",
            crate::entry::EntryType::Custom(ref s) => s.as_str(),
        };

        // Encrypt the title with the vault key so it's searchable after index decrypt
        // (We store it as base64-encoded ciphertext in the index.)
        // For simplicity, we store the title as base64 of the plaintext for now —
        // the actual per-title encryption can be layered on top.
        let title_enc = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &title);

        let idx_entry = IndexEntry {
            id: id.clone(),
            title_enc,
            category: entry_type_str.to_string(),
            tags: entry.tags.clone(),
            offset: 0, // will be set during save
            length: 0,
            favorite: entry.favorite,
            folder_id: entry.folder.clone(),
            created: entry.created,
            modified: entry.modified,
        };

        self.index.upsert_entry(idx_entry);

        // Prevent duplicate entries — replace if ID already exists
        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
            self.entries[pos] = entry;
        } else {
            self.entries.push(entry);
        }
    }

    /// Update an existing entry by id.
    pub fn update_entry(&mut self, entry: Entry) -> Result<()> {
        let id = entry.id.clone();
        let pos = self
            .entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| VaultError::EntryNotFound(id.clone()))?;

        let entry_type_str = match entry.entry_type {
            crate::entry::EntryType::Login => "login",
            crate::entry::EntryType::Note => "note",
            crate::entry::EntryType::Card => "card",
            crate::entry::EntryType::Identity => "identity",
            crate::entry::EntryType::Custom(ref s) => s.as_str(),
        };

        let title_enc =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &entry.title);

        let idx_entry = IndexEntry {
            id: id.clone(),
            title_enc,
            category: entry_type_str.to_string(),
            tags: entry.tags.clone(),
            offset: 0,
            length: 0,
            favorite: entry.favorite,
            folder_id: entry.folder.clone(),
            created: entry.created,
            modified: entry.modified,
        };

        self.entries[pos] = entry;
        self.index.upsert_entry(idx_entry);
        Ok(())
    }

    /// Get an entry by id (returns a cloned copy).
    #[must_use]
    pub fn get_entry(&self, id: &str) -> Option<Entry> {
        self.entries.iter().find(|e| e.id == id).cloned()
    }

    /// Soft-delete an entry by id (moves to recycle bin).
    pub fn delete_entry(&mut self, id: &str) -> bool {
        if let Some(pos) = self.entries.iter().position(|e| e.id == id) {
            let entry = self.entries.swap_remove(pos);
            self.deleted_entries.push(entry);
            self.index.remove_entry(id);
            true
        } else {
            false
        }
    }

    /// List all soft-deleted entries (recycle bin).
    #[must_use]
    pub fn list_deleted(&self) -> &[Entry] {
        &self.deleted_entries
    }

    /// Restore a soft-deleted entry back to live entries.
    pub fn restore_entry(&mut self, id: &str) -> bool {
        if let Some(pos) = self.deleted_entries.iter().position(|e| e.id == id) {
            let entry = self.deleted_entries.swap_remove(pos);
            let entry_type_str = match entry.entry_type {
                crate::entry::EntryType::Login => "login",
                crate::entry::EntryType::Note => "note",
                crate::entry::EntryType::Card => "card",
                crate::entry::EntryType::Identity => "identity",
                crate::entry::EntryType::Custom(ref s) => s.as_str(),
            };
            let idx_entry = IndexEntry {
                id: entry.id.clone(),
                title_enc: base64::engine::general_purpose::STANDARD.encode(&entry.title),
                category: entry_type_str.to_string(),
                tags: entry.tags.clone(),
                offset: 0,
                length: 0,
                favorite: entry.favorite,
                folder_id: entry.folder.clone(),
                created: entry.created,
                modified: entry.modified,
            };
            self.index.upsert_entry(idx_entry);
            self.entries.push(entry);
            // Remove from deleted_ids if present
            self.index.deleted_ids.retain(|d| d != id);
            true
        } else {
            false
        }
    }

    /// Permanently remove a soft-deleted entry.
    pub fn purge_entry(&mut self, id: &str) -> bool {
        if let Some(pos) = self.deleted_entries.iter().position(|e| e.id == id) {
            self.deleted_entries.swap_remove(pos);
            self.index.purge_entry(id);
            true
        } else {
            false
        }
    }

    /// Empty the recycle bin entirely.
    pub fn empty_trash(&mut self) {
        self.deleted_entries.clear();
        self.index.deleted_ids.clear();
    }

    /// Return a reference to all decrypted entries.
    #[must_use]
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// Search entries by query (case-insensitive title/username/url/notes/tags).
    #[must_use]
    pub fn search_entries(&self, query: &str) -> Vec<&Entry> {
        self.entries
            .iter()
            .filter(|e| e.matches_search(query))
            .collect()
    }

    /// Number of entries.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether vault has no entries.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

// ---------------------------------------------------------------------------
// Helpers — key derivation (shared between open & save)
// ---------------------------------------------------------------------------

fn derive_entry_key_seed(master_key: &[u8; 32]) -> [u8; 32] {
    use hkdf::Hkdf;
    use sha2::Sha256;
    let hkdf: Hkdf<Sha256> = Hkdf::new(None, master_key);
    let mut seed = [0u8; 32];
    hkdf.expand(b"pwd-vault-entry-key-seed", &mut seed)
        .expect("32 bytes is valid");
    seed
}

// ---------------------------------------------------------------------------
// Helpers — low-level read
// ---------------------------------------------------------------------------

fn read_u8(cursor: &mut Cursor<&[u8]>) -> Result<u8> {
    let mut buf = [0u8; 1];
    cursor.read_exact(&mut buf)?;
    Ok(buf[0])
}

fn read_u32_le(cursor: &mut Cursor<&[u8]>) -> Result<u32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_u16_le(cursor: &mut Cursor<&[u8]>) -> Result<u16> {
    let mut buf = [0u8; 2];
    cursor.read_exact(&mut buf)?;
    Ok(u16::from_le_bytes(buf))
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entry::EntryType;
    use tempfile::NamedTempFile;

    const TEST_PASSWORD: &str = "test-master-password-2024";

    #[test]
    fn create_and_save_empty_vault() {
        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        vault.save(&path).unwrap();
        assert!(path.exists());
        assert!(path.metadata().unwrap().len() > 0);
    }

    #[test]
    fn open_empty_vault() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        vault.save(&path).unwrap();

        let opened = VaultFile::open(TEST_PASSWORD, &path).unwrap();
        assert!(opened.is_empty());
        assert_eq!(opened.index.version, 1);
    }

    #[test]
    fn wrong_password_fails() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        vault.save(&path).unwrap();

        let result = VaultFile::open("wrong-password", &path);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), VaultError::InvalidPassword));
    }

    #[test]
    fn add_entry_and_roundtrip() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        // Create and add entries
        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let mut e1 = Entry::new("GitHub".into(), EntryType::Login);
        e1.username = "alice@example.com".into();
        e1.password = "s3cret123".into();
        e1.url = "https://github.com".into();
        e1.tags = vec!["dev".into(), "work".into()];
        e1.favorite = true;

        let mut e2 = Entry::new("Bank Note".into(), EntryType::Note);
        e2.notes = "Some banking details".into();

        vault.add_entry(e1.clone());
        vault.add_entry(e2.clone());
        assert_eq!(vault.len(), 2);

        vault.save(&path).unwrap();

        // Re-open and verify
        let opened = VaultFile::open(TEST_PASSWORD, &path).unwrap();
        assert_eq!(opened.len(), 2);

        let gh = opened.get_entry(&e1.id).unwrap();
        assert_eq!(gh.title, "GitHub");
        assert_eq!(gh.username, "alice@example.com");
        assert_eq!(gh.password, "s3cret123");
        assert_eq!(gh.url, "https://github.com");
        assert_eq!(gh.tags, vec!["dev", "work"]);
        assert!(gh.favorite);

        let note = opened.get_entry(&e2.id).unwrap();
        assert_eq!(note.title, "Bank Note");
        assert_eq!(note.notes, "Some banking details");
    }

    #[test]
    fn update_entry_roundtrip() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let mut e = Entry::new("Original".into(), EntryType::Login);
        e.password = "old-pass".into();
        vault.add_entry(e.clone());

        let id = e.id.clone();
        e.title = "Updated".into();
        e.password = "new-pass".into();
        vault.update_entry(e).unwrap();

        vault.save(&path).unwrap();

        let opened = VaultFile::open(TEST_PASSWORD, &path).unwrap();
        let entry = opened.get_entry(&id).unwrap();
        assert_eq!(entry.title, "Updated");
        assert_eq!(entry.password, "new-pass");
    }

    #[test]
    fn delete_entry_roundtrip() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let e1 = Entry::new("Entry 1".into(), EntryType::Login);
        let e2 = Entry::new("Entry 2".into(), EntryType::Login);
        let id1 = e1.id.clone();
        let id2 = e2.id.clone();

        vault.add_entry(e1);
        vault.add_entry(e2);

        assert!(vault.delete_entry(&id1));
        assert!(!vault.delete_entry("nonexistent"));

        vault.save(&path).unwrap();

        let opened = VaultFile::open(TEST_PASSWORD, &path).unwrap();
        assert_eq!(opened.len(), 1);
        assert!(opened.get_entry(&id1).is_none());
        assert!(opened.get_entry(&id2).is_some());
        assert!(opened.index.deleted_ids.contains(&id1));
    }

    #[test]
    fn search_entries_works() {
        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let mut e1 = Entry::new("GitHub".into(), EntryType::Login);
        e1.url = "https://github.com".into();
        e1.tags = vec!["dev".into()];

        let mut e2 = Entry::new("Personal Blog".into(), EntryType::Login);
        e2.url = "https://blog.example.com".into();
        e2.tags = vec!["personal".into()];

        vault.add_entry(e1);
        vault.add_entry(e2);

        let results = vault.search_entries("github");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "GitHub");

        let results = vault.search_entries("personal");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Personal Blog");
    }

    #[test]
    fn tampered_file_fails_mac() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let e = Entry::new("Secret".into(), EntryType::Login);
        vault.add_entry(e);
        vault.save(&path).unwrap();

        // Tamper with a byte in the middle of the file
        let mut data = std::fs::read(&path).unwrap();
        let tamper_pos = data.len() / 2;
        data[tamper_pos] ^= 0xFF;
        std::fs::write(&path, &data).unwrap();

        let result = VaultFile::open(TEST_PASSWORD, &path);
        assert!(result.is_err());
    }

    #[test]
    fn many_entries_roundtrip() {
        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        let mut vault = VaultFile::create(TEST_PASSWORD).unwrap();
        let mut ids = Vec::new();

        for i in 0..50 {
            let mut e = Entry::new(format!("Entry {i}"), EntryType::Login);
            e.username = format!("user{i}@test.com");
            e.password = format!("pass{i}!");
            e.tags = vec![if i % 2 == 0 { "even" } else { "odd" }.to_string()];
            ids.push(e.id.clone());
            vault.add_entry(e);
        }

        vault.save(&path).unwrap();

        let opened = VaultFile::open(TEST_PASSWORD, &path).unwrap();
        assert_eq!(opened.len(), 50);

        for (i, id) in ids.iter().enumerate() {
            let e = opened.get_entry(id).unwrap();
            assert_eq!(e.title, format!("Entry {i}"));
            assert_eq!(e.username, format!("user{i}@test.com"));
        }

        let evens = opened.search_entries("even");
        assert_eq!(evens.len(), 25);
    }
}
