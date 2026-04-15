use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Result, VaultError};

// ---------------------------------------------------------------------------
// AuditEventType
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum AuditEventType {
    VaultCreated,
    VaultOpened,
    EntryViewed { entry_id: String },
    EntryCreated { entry_id: String, title: String },
    EntryUpdated { entry_id: String, title: String },
    EntryDeleted { entry_id: String, title: String },
    PasswordCopied { entry_id: String },
    VaultLocked,
    VaultUnlocked,
    MasterPasswordChanged,
    DataExported,
    DataImported { imported: usize, skipped: usize, renamed: usize },
}

// ---------------------------------------------------------------------------
// AuditEntry
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub event_type: AuditEventType,
}

// ---------------------------------------------------------------------------
// AuditLog
// ---------------------------------------------------------------------------

pub struct AuditLog {
    entries: Vec<AuditEntry>,
    max_entries: usize,
}

impl AuditLog {
    /// Create a new, empty audit log with the default capacity of 500 entries.
    #[must_use]
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            max_entries: 500,
        }
    }

    /// Record an event.  If the log has reached `max_entries`, the oldest
    /// entry is removed first (ring-buffer behaviour).
    pub fn log(&mut self, event: AuditEventType) {
        if self.entries.len() >= self.max_entries {
            self.entries.remove(0);
        }
        self.entries.push(AuditEntry {
            timestamp: Utc::now(),
            event_type: event,
        });
    }

    /// Return a slice of the last `count` entries (or fewer if not enough).
    #[must_use]
    pub fn recent(&self, count: usize) -> &[AuditEntry] {
        let start = self.entries.len().saturating_sub(count);
        &self.entries[start..]
    }

    /// Return a slice of all entries.
    #[must_use]
    pub fn all(&self) -> &[AuditEntry] {
        &self.entries
    }

    /// Clear the log.
    pub fn clear(&mut self) {
        self.entries.clear();
    }

    /// Persist the log to `path` as pretty-printed JSON.
    pub fn save_to_file(&self, path: &std::path::Path) -> Result<()> {
        let json = serde_json::to_string_pretty(&self.entries)
            .map_err(|e| VaultError::Serialization(e.to_string()))?;
        std::fs::write(path, json)?;
        Ok(())
    }

    /// Load an audit log from a JSON file previously written by `save_to_file`.
    pub fn load_from_file(path: &std::path::Path) -> Result<Self> {
        let data = std::fs::read_to_string(path)?;
        let entries: Vec<AuditEntry> =
            serde_json::from_str(&data).map_err(|e| VaultError::Serialization(e.to_string()))?;
        Ok(Self {
            entries,
            max_entries: 500,
        })
    }
}

impl Default for AuditLog {
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
    use tempfile::NamedTempFile;

    #[test]
    fn test_audit_log_add() {
        let mut log = AuditLog::new();

        log.log(AuditEventType::VaultCreated);
        log.log(AuditEventType::EntryCreated {
            entry_id: "abc".into(),
        });
        log.log(AuditEventType::EntryViewed {
            entry_id: "abc".into(),
        });

        assert_eq!(log.all().len(), 3);

        let recent = log.recent(2);
        assert_eq!(recent.len(), 2);
        assert!(matches!(
            recent[0].event_type,
            AuditEventType::EntryCreated { .. }
        ));
        assert!(matches!(
            recent[1].event_type,
            AuditEventType::EntryViewed { .. }
        ));
    }

    #[test]
    fn test_audit_log_max_entries() {
        let mut log = AuditLog::new();
        log.max_entries = 5;

        for i in 0..10 {
            log.log(AuditEventType::EntryCreated {
                entry_id: format!("e{i}"),
            });
        }

        // Only the last 5 should remain.
        assert_eq!(log.all().len(), 5);

        // The first remaining entry should be e5 (the 6th created).
        assert!(matches!(
            &log.all()[0].event_type,
            AuditEventType::EntryCreated { entry_id } if entry_id == "e5"
        ));
    }

    #[test]
    fn test_audit_log_save_load() {
        let mut log = AuditLog::new();
        log.log(AuditEventType::VaultCreated);
        log.log(AuditEventType::DataImported { imported: 42, skipped: 3, renamed: 1 });

        let tmp = NamedTempFile::new().unwrap();
        let path = tmp.path().to_path_buf();

        log.save_to_file(&path).unwrap();

        let loaded = AuditLog::load_from_file(&path).unwrap();
        assert_eq!(loaded.all().len(), 2);
        assert!(matches!(
            loaded.all()[0].event_type,
            AuditEventType::VaultCreated
        ));
        assert!(matches!(
            loaded.all()[1].event_type,
            AuditEventType::DataImported { count: 42 }
        ));
    }
}
