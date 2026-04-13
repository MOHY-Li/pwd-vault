//! Duplicate detection for vault entries.
//!
//! Compares incoming entries against existing vault entries using
//! URL + username matching to identify potential duplicates.

use crate::entry::{Entry, EntryType};

// ---------------------------------------------------------------------------
// DedupResult
// ---------------------------------------------------------------------------

/// Result of checking a single imported entry against existing entries.
#[derive(Debug, Clone)]
pub enum DedupStatus {
    /// No matching entry found — safe to import.
    New,
    /// An existing entry matches.  Contains the index of the existing entry.
    Duplicate(usize),
    /// Partial match (e.g. same URL but different username) — needs review.
    Conflict(usize),
}

/// A single entry in the dedup report.
#[derive(Debug, Clone)]
pub struct DedupEntry {
    /// The imported entry being checked.
    pub incoming: Entry,
    /// Dedup status.
    pub status: DedupStatus,
}

// ---------------------------------------------------------------------------
// DedupEngine
// ---------------------------------------------------------------------------

/// Detects duplicates between incoming entries and existing vault entries.
pub struct DedupEngine;

impl DedupEngine {
    /// Check a list of imported entries against existing vault entries.
    /// Returns a `DedupEntry` for each imported entry with its status.
    #[must_use] 
    pub fn check(incoming: &[Entry], existing: &[Entry]) -> Vec<DedupEntry> {
        incoming
            .iter()
            .map(|entry| {
                let status = Self::classify(entry, existing);
                DedupEntry {
                    incoming: entry.clone(),
                    status,
                }
            })
            .collect()
    }

    /// Classify a single entry against existing entries.
    fn classify(entry: &Entry, existing: &[Entry]) -> DedupStatus {
        // Skip non-login entries (notes, cards) — they rarely duplicate.
        if entry.entry_type != EntryType::Login {
            return DedupStatus::New;
        }

        // Normalize URL for comparison.
        let entry_url = normalize_url(&entry.url);
        let entry_user = entry.username.trim().to_lowercase();

        if entry_url.is_empty() && entry_user.is_empty() {
            return DedupStatus::New;
        }

        // First pass: check for exact duplicate (same URL + same username).
        for (i, ex) in existing.iter().enumerate() {
            if ex.entry_type != EntryType::Login {
                continue;
            }
            let ex_url = normalize_url(&ex.url);
            let ex_user = ex.username.trim().to_lowercase();

            if entry_url == ex_url && !entry_url.is_empty() && entry_user == ex_user && !entry_user.is_empty() {
                return DedupStatus::Duplicate(i);
            }
        }

        // Second pass: check for conflict (same URL, different username).
        for (i, ex) in existing.iter().enumerate() {
            if ex.entry_type != EntryType::Login {
                continue;
            }
            let ex_url = normalize_url(&ex.url);

            if entry_url == ex_url && !entry_url.is_empty() {
                return DedupStatus::Conflict(i);
            }
        }

        // No URL match but check if same title + username (for entries without URLs).
        if entry_url.is_empty() {
            for (i, ex) in existing.iter().enumerate() {
                let ex_user = ex.username.trim().to_lowercase();
                if ex.title.trim().to_lowercase() == entry.title.trim().to_lowercase()
                    && ex_user == entry_user
                    && !entry_user.is_empty()
                {
                    return DedupStatus::Duplicate(i);
                }
            }
        }

        DedupStatus::New
    }

    /// Filter incoming entries to only those that are new (no duplicates).
    #[must_use] 
    pub fn filter_new(incoming: &[Entry], existing: &[Entry]) -> Vec<Entry> {
        Self::check(incoming, existing)
            .into_iter()
            .filter(|d| matches!(d.status, DedupStatus::New))
            .map(|d| d.incoming)
            .collect()
    }

    /// Count duplicates and conflicts.
    #[must_use] 
    pub fn count_issues(incoming: &[Entry], existing: &[Entry]) -> (usize, usize) {
        let report = Self::check(incoming, existing);
        let dupes = report
            .iter()
            .filter(|d| matches!(d.status, DedupStatus::Duplicate(_)))
            .count();
        let conflicts = report
            .iter()
            .filter(|d| matches!(d.status, DedupStatus::Conflict(_)))
            .count();
        (dupes, conflicts)
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Normalize a URL for comparison by stripping scheme, trailing slashes,
/// and common prefixes like "www.".
fn normalize_url(url: &str) -> String {
    let mut s = url.trim().to_lowercase();

    // Strip common schemes.
    for prefix in &["https://", "http://", "www."] {
        if s.starts_with(prefix) {
            s = s[prefix.len()..].to_string();
        }
    }

    // Strip trailing slash.
    if s.ends_with('/') {
        s.pop();
    }

    // Strip everything after the first '/' or '?' or '#' to get just the domain.
    if let Some(pos) = s.find(['/', '?', '#']) {
        s.truncate(pos);
    }

    s
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_login(title: &str, username: &str, url: &str) -> Entry {
        let mut e = Entry::new(title.to_string(), EntryType::Login);
        e.username = username.to_string();
        e.url = url.to_string();
        e
    }

    #[test]
    fn detect_exact_duplicate() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let incoming = vec![make_login("GitHub", "alice", "https://github.com")];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::Duplicate(0)));
    }

    #[test]
    fn detect_conflict_same_url_different_user() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let incoming = vec![make_login("GitHub Work", "bob", "https://github.com")];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::Conflict(0)));
    }

    #[test]
    fn new_entry_no_match() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let incoming = vec![make_login("GitLab", "alice", "https://gitlab.com")];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::New));
    }

    #[test]
    fn non_login_always_new() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let mut note = Entry::new("My Note".into(), EntryType::Note);
        note.url = "https://github.com".into();
        let incoming = vec![note];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::New));
    }

    #[test]
    fn url_normalization() {
        let existing = vec![make_login("GitHub", "alice", "https://www.github.com/")];
        let incoming = vec![make_login("GitHub", "alice", "http://github.com")];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::Duplicate(0)));
    }

    #[test]
    fn filter_new_entries() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let incoming = vec![
            make_login("GitHub", "alice", "https://github.com"), // duplicate
            make_login("GitLab", "alice", "https://gitlab.com"), // new
            make_login("GitHub", "bob", "https://github.com"),   // conflict
        ];

        let new = DedupEngine::filter_new(&incoming, &existing);
        assert_eq!(new.len(), 1);
        assert_eq!(new[0].title, "GitLab");
    }

    #[test]
    fn count_issues() {
        let existing = vec![make_login("GitHub", "alice", "https://github.com")];
        let incoming = vec![
            make_login("GitHub", "alice", "https://github.com"),
            make_login("GitLab", "alice", "https://gitlab.com"),
            make_login("GitHub", "bob", "https://github.com"),
        ];

        let (dupes, conflicts) = DedupEngine::count_issues(&incoming, &existing);
        assert_eq!(dupes, 1);
        assert_eq!(conflicts, 1);
    }

    #[test]
    fn duplicate_by_title_and_username_no_url() {
        let mut existing = vec![];
        let mut e = Entry::new("WiFi".into(), EntryType::Login);
        e.username = "admin".into();
        existing.push(e);

        let mut incoming_e = Entry::new("WiFi".into(), EntryType::Login);
        incoming_e.username = "admin".into();
        let incoming = vec![incoming_e];

        let report = DedupEngine::check(&incoming, &existing);
        assert!(matches!(report[0].status, DedupStatus::Duplicate(0)));
    }

    #[test]
    fn empty_entries_all_new() {
        let incoming = vec![
            make_login("Site A", "user", "https://a.com"),
            make_login("Site B", "user", "https://b.com"),
        ];

        let report = DedupEngine::check(&incoming, &[]);
        assert!(matches!(report[0].status, DedupStatus::New));
        assert!(matches!(report[1].status, DedupStatus::New));
    }
}
