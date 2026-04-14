use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Overall strength classification for a password.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub enum StrengthLevel {
    VeryWeak,
    Weak,
    Moderate,
    Strong,
    VeryStrong,
}

/// Detailed report returned by [`evaluate_password`].
#[derive(Serialize, Clone, Debug)]
pub struct StrengthReport {
    pub entropy: f64,
    pub level: StrengthLevel,
    pub crack_time: String,
    pub score: u8,
    pub warnings: Vec<String>,
    pub suggestions: Vec<String>,
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Top-20 most common passwords (used for pattern detection).
const COMMON_PASSWORDS: &[&str] = &[
    "password", "123456", "12345678", "qwerty", "abc123", "monkey", "1234567", "letmein",
    "trustno1", "dragon", "baseball", "iloveyou", "master", "sunshine", "ashley", "bailey",
    "passw0rd", "shadow", "123123", "654321",
];

/// Keyboard-walk patterns (lowercase, forward direction).
const KEYBOARD_WALKS: &[&str] = &[
    "qwerty",
    "qwertz",
    "asdf",
    "zxcv",
    "qazwsx",
    "1qaz2wsx",
    "1234qwer",
    "!@#$%^&*",
    "qweasdzxc",
];

/// Online attack guess rate (guesses per second).
const GUESS_RATE: f64 = 1e10;

/// Seconds per time unit.
const SECS_PER_MIN: f64 = 60.0;
const SECS_PER_HOUR: f64 = 3_600.0;
const SECS_PER_DAY: f64 = 86_400.0;
const SECS_PER_YEAR: f64 = 31_536_000.0;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Evaluate the strength of `password` and return a full [`StrengthReport`].
#[must_use]
pub fn evaluate_password(password: &str) -> StrengthReport {
    let mut warnings: Vec<String> = Vec::new();
    let mut suggestions: Vec<String> = Vec::new();

    // --- entropy ---------------------------------------------------------
    let entropy = calculate_entropy(password);

    // --- pattern detection -----------------------------------------------
    if password.is_empty() {
        warnings.push("Password is empty".into());
        suggestions.push("Use a password with at least 12 characters".into());
    } else {
        if is_common_password(password) {
            warnings.push("Password is in the list of most common passwords".into());
            suggestions.push("Avoid commonly used passwords".into());
        }
        if is_all_same_char(password) {
            warnings.push("All characters are identical".into());
            suggestions.push("Use a variety of different characters".into());
        }
        if let Some(seq) = find_sequential_run(password) {
            warnings.push(format!("Contains sequential characters: \"{seq}\""));
            suggestions.push("Avoid sequences like \"abc\" or \"123\"".into());
        }
        if let Some(pat) = find_repeated_pattern(password) {
            warnings.push(format!("Contains repeated pattern: \"{pat}\""));
            suggestions.push("Avoid repeating substrings".into());
        }
        if let Some(walk) = find_keyboard_walk(password) {
            warnings.push(format!("Contains keyboard walk: \"{walk}\""));
            suggestions.push("Avoid adjacent-key patterns".into());
        }
        if password.len() < 8 {
            suggestions.push("Use at least 8 characters, ideally 12 or more".into());
        }
        let (has_lower, has_upper, has_digit, has_symbol) = classify_charset(password);
        let charset_count = [has_lower, has_upper, has_digit, has_symbol]
            .iter()
            .filter(|&&x| x)
            .count();
        if charset_count < 3 {
            suggestions
                .push("Mix uppercase, lowercase, digits, and symbols for higher entropy".into());
        }
    }

    // --- crack time ------------------------------------------------------
    let seconds = estimate_crack_time_seconds(entropy);
    let crack_time = format_crack_time(seconds);

    // --- level & score ---------------------------------------------------
    let level = entropy_to_level(entropy);
    let score = entropy_to_score(entropy);

    StrengthReport {
        entropy,
        level,
        crack_time,
        score,
        warnings,
        suggestions,
    }
}

/// Estimated time to crack (seconds) at [`GUESS_RATE`] guesses/sec.
///
/// `guesses = 2^entropy`, so `seconds = guesses / rate`.
#[must_use]
pub fn estimate_crack_time_seconds(entropy: f64) -> f64 {
    if entropy <= 0.0 {
        return 0.0;
    }
    2.0_f64.powf(entropy) / GUESS_RATE
}

/// Convert seconds into a human-readable string.
#[must_use]
pub fn format_crack_time(seconds: f64) -> String {
    if seconds < 1.0 {
        "instant".into()
    } else if seconds < SECS_PER_MIN {
        format!("{} seconds", seconds.floor() as u64)
    } else if seconds < SECS_PER_HOUR {
        let mins = (seconds / SECS_PER_MIN).floor() as u64;
        format!("{mins} minutes")
    } else if seconds < SECS_PER_DAY {
        let hrs = (seconds / SECS_PER_HOUR).floor() as u64;
        format!("{hrs} hours")
    } else if seconds < SECS_PER_YEAR {
        let days = (seconds / SECS_PER_DAY).floor() as u64;
        format!("{days} days")
    } else if seconds < SECS_PER_YEAR * 100.0 {
        let years = (seconds / SECS_PER_YEAR).floor() as u64;
        format!("{years} years")
    } else {
        "centuries".into()
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Charset-based entropy: `len * log2(pool_size)`.
///
/// The pool size is determined by the unique characters present:
///
/// | subset          | size |
/// |-----------------|------|
/// | lowercase a-z   | 26   |
/// | uppercase A-Z   | 26   |
/// | digits 0-9      | 10   |
/// | symbols (rest)  | 33   |
fn calculate_entropy(password: &str) -> f64 {
    if password.is_empty() {
        return 0.0;
    }

    let mut pool: u32 = 0;
    for ch in password.chars() {
        if ch.is_ascii_lowercase() {
            pool |= 1;
        } else if ch.is_ascii_uppercase() {
            pool |= 2;
        } else if ch.is_ascii_digit() {
            pool |= 4;
        } else {
            pool |= 8;
        }
    }

    let pool_size: f64 = f64::from(
        u32::from(pool & 1 != 0) * 26
            + u32::from((pool >> 1) & 1 != 0) * 26
            + u32::from((pool >> 2) & 1 != 0) * 10
            + u32::from((pool >> 3) & 1 != 0) * 33,
    );

    if pool_size <= 1.0 {
        // e.g. single repeated char → at most 1 bit of info
        return (password.len() as f64) * 1.0_f64.log2();
    }

    (password.len() as f64) * pool_size.log2()
}

fn entropy_to_level(entropy: f64) -> StrengthLevel {
    if entropy < 28.0 {
        StrengthLevel::VeryWeak
    } else if entropy < 36.0 {
        StrengthLevel::Weak
    } else if entropy < 60.0 {
        StrengthLevel::Moderate
    } else if entropy < 80.0 {
        StrengthLevel::Strong
    } else {
        StrengthLevel::VeryStrong
    }
}

/// Map entropy in the range 0..=128 to a score 0..=100.
fn entropy_to_score(entropy: f64) -> u8 {
    let ratio = (entropy / 128.0).min(1.0);
    (ratio * 100.0).round() as u8
}

fn is_common_password(password: &str) -> bool {
    let lower = password.to_ascii_lowercase();
    COMMON_PASSWORDS.contains(&lower.as_str())
}

fn is_all_same_char(password: &str) -> bool {
    if password.is_empty() {
        return false;
    }
    let first = password.chars().next().unwrap();
    password.chars().all(|c| c == first)
}

/// Check for a sequential run of 3+ characters (e.g. "abc", "cba", "123", "321").
fn find_sequential_run(password: &str) -> Option<String> {
    let chars: Vec<char> = password.chars().collect();
    if chars.len() < 3 {
        return None;
    }

    let mut run_start = 0usize;
    let mut run_dir: Option<i32> = None; // +1 ascending, -1 descending

    for i in 1..chars.len() {
        let diff = chars[i] as i32 - chars[i - 1] as i32;
        let dir = if diff == 1 {
            Some(1)
        } else if diff == -1 {
            Some(-1)
        } else {
            None
        };

        if dir.is_some() && (run_dir.is_none() || run_dir == dir) {
            if run_dir.is_none() {
                run_start = i - 1;
            }
            run_dir = dir;
            // Check if we've got a run of at least 3
            if i - run_start + 1 >= 3 {
                let seq: String = chars[run_start..=i].iter().collect();
                return Some(seq);
            }
        } else {
            run_dir = None;
        }
    }
    None
}

/// Detect a non-trivial substring (length >= 2) that appears 2+ times.
fn find_repeated_pattern(password: &str) -> Option<String> {
    if password.len() < 4 {
        return None;
    }
    let lower = password.to_ascii_lowercase();
    let max_sublen = lower.len() / 2;
    for sublen in 2..=max_sublen {
        for start in 0..=lower.len() - sublen {
            let sub = &lower[start..start + sublen];
            let rest = &lower[start + sublen..];
            if rest.contains(sub) {
                return Some(sub.into());
            }
        }
    }
    None
}

/// Check if the password (lowercased) contains a known keyboard-walk pattern.
fn find_keyboard_walk(password: &str) -> Option<String> {
    let lower = password.to_ascii_lowercase();
    for walk in KEYBOARD_WALKS {
        if lower.contains(walk) {
            return Some((*walk).into());
        }
    }
    None
}

/// Return which charset categories are present.
fn classify_charset(password: &str) -> (bool, bool, bool, bool) {
    let mut lower = false;
    let mut upper = false;
    let mut digit = false;
    let mut symbol = false;
    for ch in password.chars() {
        if ch.is_ascii_lowercase() {
            lower = true;
        } else if ch.is_ascii_uppercase() {
            upper = true;
        } else if ch.is_ascii_digit() {
            digit = true;
        } else {
            symbol = true;
        }
    }
    (lower, upper, digit, symbol)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_password() {
        let report = evaluate_password("");
        assert_eq!(report.level, StrengthLevel::VeryWeak);
        assert_eq!(report.entropy, 0.0);
        assert_eq!(report.score, 0);
    }

    #[test]
    fn test_common_password() {
        let report = evaluate_password("password");
        assert!(
            report
                .warnings
                .iter()
                .any(|w| w.contains("most common passwords"))
        );
    }

    #[test]
    fn test_strong_password() {
        let report = evaluate_password("K#9m$Xp2vL!nR7@q");
        // 16 chars, 4 charset categories → entropy = 16*log2(95) ≈ 105
        assert!(report.level == StrengthLevel::Strong || report.level == StrengthLevel::VeryStrong);
        assert!(report.entropy >= 60.0);
    }

    #[test]
    fn test_all_same_char() {
        let report = evaluate_password("aaaaaaa");
        assert!(report.level == StrengthLevel::VeryWeak || report.level == StrengthLevel::Weak);
        assert!(report.warnings.iter().any(|w| w.contains("identical")));
    }

    #[test]
    fn test_crack_time_formatting() {
        assert_eq!(format_crack_time(0.0), "instant");
        assert_eq!(format_crack_time(0.5), "instant");
        assert_eq!(format_crack_time(30.0), "30 seconds");
        assert_eq!(format_crack_time(120.0), "2 minutes");
        assert_eq!(format_crack_time(7200.0), "2 hours");
        assert_eq!(format_crack_time(172_800.0), "2 days");
        assert_eq!(format_crack_time(SECS_PER_YEAR * 5.0), "5 years");
        assert_eq!(format_crack_time(SECS_PER_YEAR * 500.0), "centuries");
    }

    #[test]
    fn test_entropy_calculation() {
        // "abc" → 3 chars, 1 pool (lowercase 26) → 3 * log2(26) ≈ 14.1
        let e = calculate_entropy("abc");
        assert!((e - (3.0_f64 * 26.0_f64.log2())).abs() < 0.01);

        // empty → 0
        assert_eq!(calculate_entropy(""), 0.0);

        // mixed charset
        let e2 = calculate_entropy("aA1!");
        // pool = 26+26+10+33 = 95
        assert!((e2 - (4.0_f64 * 95.0_f64.log2())).abs() < 0.01);
    }

    #[test]
    fn test_sequential_detection() {
        assert!(find_sequential_run("abc").is_some());
        assert!(find_sequential_run("xyz").is_some());
        assert!(find_sequential_run("cba").is_some());
        assert!(find_sequential_run("123").is_some());
        assert!(find_sequential_run("a1b2c3").is_none());
    }

    #[test]
    fn test_keyboard_walk_detection() {
        assert!(find_keyboard_walk("qwerty123").is_some());
        assert!(find_keyboard_walk("myasdfpass").is_some());
        assert!(find_keyboard_walk("randomzxcvstuff").is_some());
        assert!(find_keyboard_walk("noplease").is_none());
    }

    #[test]
    fn test_repeated_pattern() {
        assert!(find_repeated_pattern("abcabc").is_some());
        assert!(find_repeated_pattern("xx").is_none()); // too short
    }

    #[test]
    fn test_estimate_crack_time_seconds() {
        // entropy 0 → 0
        assert_eq!(estimate_crack_time_seconds(0.0), 0.0);
        // entropy 33: 2^33 / 1e10 ≈ 0.86 s
        let secs = estimate_crack_time_seconds(33.0);
        assert!(secs > 0.0 && secs < 2.0);
    }
}
