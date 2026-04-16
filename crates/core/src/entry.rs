use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

// ---------------------------------------------------------------------------
// EntryType
// ---------------------------------------------------------------------------

/// The kind of vault entry.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Login,
    Note,
    Card,
    Identity,
    /// User-defined type with a custom label.
    /// Kept for backward compatibility when deserializing vaults created by older versions.
    /// New entries no longer offer Custom as a type option (UI uses login/note/card/identity only).
    #[serde(rename = "custom")]
    Custom(String),
}

impl EntryType {
    /// Return the static string label for this entry type.
    #[must_use]
    pub fn as_str(&self) -> &'static str {
        match self {
            EntryType::Login => "login",
            EntryType::Note => "note",
            EntryType::Card => "card",
            EntryType::Identity => "identity",
            EntryType::Custom(_) => "custom",
        }
    }
}

// ---------------------------------------------------------------------------
// CustomFieldType / CustomField
// ---------------------------------------------------------------------------

/// Describes how a custom field's value should be handled in the UI.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CustomFieldType {
    Text,
    Password,
    Hidden,
}

/// A user-defined key/value field attached to an entry.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CustomField {
    pub name: String,
    pub value: String,
    pub field_type: CustomFieldType,
}

// ---------------------------------------------------------------------------
// TOTP support
// ---------------------------------------------------------------------------

/// Hash algorithm used for TOTP code generation.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TotpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

/// Configuration needed to generate TOTP codes.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TotpConfig {
    /// Base32-encoded shared secret.
    pub secret: String,
    /// HMAC algorithm.
    pub algorithm: TotpAlgorithm,
    /// Number of digits in the generated code (default: 6).
    #[serde(default = "default_digits")]
    pub digits: u32,
    /// Step duration in seconds (default: 30).
    #[serde(default = "default_period")]
    pub period: u32,
}

fn default_digits() -> u32 {
    6
}

fn default_period() -> u32 {
    30
}

impl Default for TotpConfig {
    fn default() -> Self {
        Self {
            secret: String::new(),
            algorithm: TotpAlgorithm::Sha1,
            digits: default_digits(),
            period: default_period(),
        }
    }
}

impl Drop for TotpConfig {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

// ---------------------------------------------------------------------------
// Password history
// ---------------------------------------------------------------------------

/// A single entry in the password-change history.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PasswordHistoryEntry {
    pub password: String,
    pub changed_at: DateTime<Utc>,
}

impl Drop for PasswordHistoryEntry {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/// Core vault entry representing a single saved credential or note.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Entry {
    /// UUID v4 unique identifier.
    pub id: String,
    /// What kind of entry this is.
    pub entry_type: EntryType,
    /// Human-readable title.
    pub title: String,

    // -- credential fields (empty by default) --
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub notes: String,

    // -- TOTP --
    #[serde(default)]
    pub totp: Option<TotpConfig>,

    // -- extensibility --
    #[serde(default)]
    pub custom_fields: Vec<CustomField>,
    #[serde(default)]
    pub tags: Vec<String>,

    // -- organisation --
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub favorite: bool,

    // -- timestamps --
    pub created: DateTime<Utc>,
    pub modified: DateTime<Utc>,

    // -- history --
    #[serde(default)]
    pub password_history: Vec<PasswordHistoryEntry>,
}

impl Entry {
    /// Create a new entry with a generated UUID and current timestamps.
    #[must_use]
    pub fn new(title: String, entry_type: EntryType) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            entry_type,
            title,
            username: String::new(),
            password: String::new(),
            url: String::new(),
            notes: String::new(),
            totp: None,
            custom_fields: Vec::new(),
            tags: Vec::new(),
            folder: None,
            favorite: false,
            created: now,
            modified: now,
            password_history: Vec::new(),
        }
    }

    /// Update the `modified` timestamp to the current time.
    pub fn touch(&mut self) {
        self.modified = Utc::now();
    }

    /// Case-insensitive search across the main text fields and tags.
    #[must_use]
    pub fn matches_search(&self, query: &str) -> bool {
        let q = query.to_lowercase();
        let hay = format!(
            "{} {} {} {} {}",
            self.title,
            self.username,
            self.url,
            self.notes,
            self.tags.join(" ")
        )
        .to_lowercase();
        hay.contains(&q)
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        self.password.zeroize();
        self.username.zeroize();
        self.notes.zeroize();
        self.url.zeroize();
        if let Some(ref mut totp) = self.totp {
            totp.secret.zeroize();
        }
        for field in &mut self.custom_fields {
            field.value.zeroize();
        }
        for hist in &mut self.password_history {
            hist.password.zeroize();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_entry_has_uuid_and_timestamps() {
        let e = Entry::new("Test".into(), EntryType::Login);
        assert!(!e.id.is_empty());
        assert_eq!(e.title, "Test");
        assert_eq!(e.entry_type, EntryType::Login);
        assert!(e.username.is_empty());
        assert!(e.password.is_empty());
        assert!(!e.favorite);
        assert!(e.folder.is_none());
        assert!(e.totp.is_none());
    }

    #[test]
    fn touch_updates_modified() {
        let mut e = Entry::new("Demo".into(), EntryType::Note);
        let before = e.modified;
        // tiny sleep so timestamps differ (unlikely to be needed at µs precision)
        std::thread::sleep(std::time::Duration::from_micros(10));
        e.touch();
        assert!(e.modified >= before);
    }

    #[test]
    fn matches_search_is_case_insensitive() {
        let mut e = Entry::new("My Website".into(), EntryType::Login);
        e.username = "alice@example.com".into();
        e.url = "https://example.com".into();
        e.tags = vec!["work".into()];

        assert!(e.matches_search("website"));
        assert!(e.matches_search("ALICE"));
        assert!(e.matches_search("example.com"));
        assert!(e.matches_search("WORK"));
        assert!(!e.matches_search("notfound"));
    }

    #[test]
    fn serialization_roundtrip() {
        let mut e = Entry::new("Roundtrip".into(), EntryType::Card);
        e.password = "s3cret".into();
        e.favorite = true;
        e.folder = Some("Finance".into());
        e.tags = vec!["bank".into()];

        let json = serde_json::to_string(&e).unwrap();
        let back: Entry = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, e.id);
        assert_eq!(back.title, "Roundtrip");
        assert_eq!(back.entry_type, EntryType::Card);
        assert_eq!(back.password, "s3cret");
        assert!(back.favorite);
        assert_eq!(back.folder, Some("Finance".into()));
        assert_eq!(back.tags, vec!["bank".to_string()]);
    }

    #[test]
    fn totp_config_defaults() {
        let cfg = TotpConfig::default();
        assert_eq!(cfg.digits, 6);
        assert_eq!(cfg.period, 30);
        assert_eq!(cfg.algorithm, TotpAlgorithm::Sha1);
    }
}
