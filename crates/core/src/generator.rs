//! Password generation module with charset-based and diceware-style generators.

use crate::error::VaultError;

// ---------------------------------------------------------------------------
// CharSet configuration
// ---------------------------------------------------------------------------

/// Configuration describing which character categories to include in a password.
#[derive(Clone, Debug)]
#[allow(clippy::struct_excessive_bools)]
pub struct CharSet {
    pub uppercase: bool,
    pub lowercase: bool,
    pub digits: bool,
    pub special: bool,
    pub exclude_ambiguous: bool,
    pub exclude_custom: String,
}

impl Default for CharSet {
    fn default() -> Self {
        Self {
            uppercase: true,
            lowercase: true,
            digits: true,
            special: true,
            exclude_ambiguous: false,
            exclude_custom: String::new(),
        }
    }
}

impl CharSet {
    /// Build the concrete list of characters from the configuration flags.
    ///
    /// Ambiguous characters: `0 O 1 l I | \` '`
    #[allow(clippy::doc_markdown)]
    #[must_use]
    pub fn build_charset(&self) -> Vec<char> {
        const AMBIGUOUS: &[char] = &['0', 'O', '1', 'l', 'I', '|', '`', '\''];

        let mut chars: Vec<char> = Vec::new();

        if self.uppercase {
            chars.extend('A'..='Z');
        }
        if self.lowercase {
            chars.extend('a'..='z');
        }
        if self.digits {
            chars.extend('0'..='9');
        }
        if self.special {
            const SPECIAL_CHARS: &[char] = &[
                '!', '"', '#', '$', '%', '&', '(', ')', '*', '+', ',', '-', '.', '/', ':', ';',
                '<', '=', '>', '?', '@', '[', '\\', ']', '^', '_', '{', '|', '}', '~',
            ];
            chars.extend(SPECIAL_CHARS.iter().copied());
        }

        // Fallback: if nothing was enabled, use lowercase so we never produce an empty charset.
        if chars.is_empty() {
            chars.extend('a'..='z');
        }

        if self.exclude_ambiguous {
            chars.retain(|c| !AMBIGUOUS.contains(c));
        }

        if !self.exclude_custom.is_empty() {
            let exclude: Vec<char> = self.exclude_custom.chars().collect();
            chars.retain(|c| !exclude.contains(c));
        }

        // Deduplicate (special chars overlap with ranges in rare cases).
        chars.sort_unstable();
        chars.dedup();

        chars
    }

    /// Shannon entropy per character given the current charset size.
    #[must_use]
    pub fn entropy_per_char(&self) -> f64 {
        let charset = self.build_charset();
        let n = charset.len() as f64;
        if n <= 1.0 { 0.0 } else { n.log2() }
    }
}

// ---------------------------------------------------------------------------
// GeneratorConfig
// ---------------------------------------------------------------------------

/// Top-level configuration for the random-password generator.
#[derive(Clone, Debug)]
pub struct GeneratorConfig {
    pub length: usize,
    pub charset: CharSet,
}

impl Default for GeneratorConfig {
    fn default() -> Self {
        Self {
            length: 20,
            charset: CharSet::default(),
        }
    }
}

// ---------------------------------------------------------------------------
// CSPRNG helpers
// ---------------------------------------------------------------------------

/// Fill a buffer with cryptographically-secure random bytes via `getrandom`.
fn csp_random_bytes(len: usize) -> crate::error::Result<Vec<u8>> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).map_err(|e| VaultError::Crypto(e.to_string()))?;
    Ok(buf)
}

/// Return a uniformly random index in `[0, max)`.
///
/// Uses rejection sampling to avoid modulo bias.
fn csp_random_index(max: usize) -> crate::error::Result<usize> {
    if max == 0 {
        return Err(VaultError::Crypto(
            "csp_random_index: max must be > 0".into(),
        ));
    }
    if max == 1 {
        return Ok(0);
    }
    // We read 8 bytes (u64) and reject values >= the largest multiple of max ≤ u64::MAX.
    let rand_max = u64::MAX;
    let limit = rand_max - (rand_max % max as u64);
    loop {
        let bytes = csp_random_bytes(8)?;
        let val = u64::from_le_bytes(bytes.as_slice().try_into().expect("8 bytes"));
        if val < limit {
            return Ok((val % max as u64) as usize);
        }
    }
}

// ---------------------------------------------------------------------------
// Password generation
// ---------------------------------------------------------------------------

/// Generate a random password according to `config`.
///
/// Guarantees at least one character from each **enabled** category is present,
/// then shuffles with Fisher-Yates.
pub fn generate_password(config: &GeneratorConfig) -> crate::error::Result<String> {
    if config.length == 0 {
        return Err(VaultError::Crypto("password length must be > 0".into()));
    }

    let charset = config.charset.build_charset();
    if charset.is_empty() {
        return Err(VaultError::Crypto(
            "charset is empty after exclusions".into(),
        ));
    }

    // Build per-category charsets for the guarantee step.
    let uc: Vec<char> = if config.charset.uppercase {
        let mut s: Vec<char> = ('A'..='Z').collect();
        if config.charset.exclude_ambiguous {
            s.retain(|c| !['O', 'I'].contains(c));
        }
        s.retain(|c| charset.contains(c));
        s
    } else {
        Vec::new()
    };

    let lc: Vec<char> = if config.charset.lowercase {
        let mut s: Vec<char> = ('a'..='z').collect();
        if config.charset.exclude_ambiguous {
            s.retain(|c| !['l'].contains(c));
        }
        s.retain(|c| charset.contains(c));
        s
    } else {
        Vec::new()
    };

    let dc: Vec<char> = if config.charset.digits {
        let mut s: Vec<char> = ('0'..='9').collect();
        if config.charset.exclude_ambiguous {
            s.retain(|c| !['0', '1'].contains(c));
        }
        s.retain(|c| charset.contains(c));
        s
    } else {
        Vec::new()
    };

    let sc: Vec<char> = if config.charset.special {
        let mut s = vec![
            '!', '"', '#', '$', '%', '&', '(', ')', '*', '+', ',', '-', '.', '/', ':', ';', '<',
            '=', '>', '?', '@', '[', '\\', ']', '^', '_', '{', '|', '}', '~',
        ];
        if config.charset.exclude_ambiguous {
            s.retain(|c| !['|', '\'', '`'].contains(c));
        }
        s.retain(|c| charset.contains(c));
        s
    } else {
        Vec::new()
    };

    // Ensure we have room for at least one char from each enabled category.
    let required: usize = [
        !uc.is_empty(),
        !lc.is_empty(),
        !dc.is_empty(),
        !sc.is_empty(),
    ]
    .into_iter()
    .filter(|&b| b)
    .count();

    if config.length < required {
        return Err(VaultError::Crypto(
            "password length too short for the enabled character categories".into(),
        ));
    }

    let mut result: Vec<char> = Vec::with_capacity(config.length);

    // Guarantee one from each enabled category.
    for cat in [&uc, &lc, &dc, &sc] {
        if cat.is_empty() {
            continue;
        }
        let idx = csp_random_index(cat.len())?;
        result.push(cat[idx]);
    }

    // Fill remaining slots from the full charset.
    while result.len() < config.length {
        let idx = csp_random_index(charset.len())?;
        result.push(charset[idx]);
    }

    // Fisher-Yates shuffle.
    for i in (1..result.len()).rev() {
        let j = csp_random_index(i + 1)?;
        result.swap(i, j);
    }

    Ok(result.into_iter().collect())
}

// ---------------------------------------------------------------------------
// Diceware-style generation (syllable-based)
// ---------------------------------------------------------------------------

const CONSONANTS: &[char] = &[
    'b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'x', 'y',
    'z',
];

const VOWELS: &[char] = &['a', 'e', 'i', 'o', 'u'];

/// Generate a pronounceable, syllable-based "diceware-style" passphrase component.
///
/// Each word consists of 2 or 3 syllables where a syllable is a random consonant
/// followed by a random vowel, optionally followed by a trailing consonant.
fn random_word() -> crate::error::Result<String> {
    let syllable_count = 2 + csp_random_index(2)?; // 2 or 3
    let mut word = String::with_capacity(syllable_count * 3);

    for _ in 0..syllable_count {
        let ci = csp_random_index(CONSONANTS.len())?;
        let vi = csp_random_index(VOWELS.len())?;
        word.push(CONSONANTS[ci]);
        word.push(VOWELS[vi]);

        // 50% chance of trailing consonant
        if csp_random_index(2)? == 0 {
            let ti = csp_random_index(CONSONANTS.len())?;
            word.push(CONSONANTS[ti]);
        }
    }

    Ok(word)
}

/// Generate a diceware-style passphrase composed of `word_count` random
/// pronounceable words joined by `separator`.
pub fn generate_diceware(word_count: usize, separator: &str) -> crate::error::Result<String> {
    if word_count == 0 {
        return Err(VaultError::Crypto("word_count must be > 0".into()));
    }

    let mut words: Vec<String> = Vec::with_capacity(word_count);
    for _ in 0..word_count {
        words.push(random_word()?);
    }

    Ok(words.join(separator))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_password_length() {
        let config = GeneratorConfig::default();
        let pw = generate_password(&config).unwrap();
        assert_eq!(pw.len(), config.length);

        let short = GeneratorConfig {
            length: 4,
            charset: CharSet {
                uppercase: true,
                lowercase: true,
                digits: false,
                special: false,
                exclude_ambiguous: false,
                exclude_custom: String::new(),
            },
        };
        let pw2 = generate_password(&short).unwrap();
        assert_eq!(pw2.len(), 4);
    }

    #[test]
    fn test_generate_password_charset() {
        // Only digits
        let config = GeneratorConfig {
            length: 50,
            charset: CharSet {
                uppercase: false,
                lowercase: false,
                digits: true,
                special: false,
                exclude_ambiguous: false,
                exclude_custom: String::new(),
            },
        };
        let pw = generate_password(&config).unwrap();
        assert!(pw.chars().all(|c| c.is_ascii_digit()));

        // Only uppercase + lowercase, exclude ambiguous
        let config2 = GeneratorConfig {
            length: 80,
            charset: CharSet {
                uppercase: true,
                lowercase: true,
                digits: false,
                special: false,
                exclude_ambiguous: true,
                exclude_custom: String::new(),
            },
        };
        let pw2 = generate_password(&config2).unwrap();
        let ambiguous = ['0', 'O', '1', 'l', 'I', '|', '`', '\''];
        assert!(pw2.chars().all(|c| !ambiguous.contains(&c)));
    }

    #[test]
    fn test_generate_password_unique() {
        let config = GeneratorConfig::default();
        let mut passwords = std::collections::HashSet::new();
        for _ in 0..100 {
            passwords.insert(generate_password(&config).unwrap());
        }
        // With length 20 and full charset, all 100 should be unique.
        assert_eq!(passwords.len(), 100);
    }

    #[test]
    fn test_diceware_word_count() {
        let phrase = generate_diceware(6, "-").unwrap();
        let parts: Vec<&str> = phrase.split('-').collect();
        assert_eq!(parts.len(), 6);

        let phrase2 = generate_diceware(4, " ").unwrap();
        let parts2: Vec<&str> = phrase2.split(' ').collect();
        assert_eq!(parts2.len(), 4);
    }

    #[test]
    fn test_diceware_separator() {
        let phrase = generate_diceware(3, "::").unwrap();
        assert_eq!(phrase.matches("::").count(), 2);

        let phrase2 = generate_diceware(5, "").unwrap();
        // No separator — should just be concatenated syllable-words.
        assert!(!phrase2.is_empty());
    }

    #[test]
    fn test_charset_entropy() {
        // Full default charset (upper + lower + digit + special, ~94 chars before dedup)
        let cs = CharSet::default();
        let entropy = cs.entropy_per_char();
        assert!(
            entropy > 6.0,
            "full charset entropy should be > 6 bits/char, got {entropy}"
        );

        // Digits only (10 chars)
        let digits = CharSet {
            uppercase: false,
            lowercase: false,
            digits: true,
            special: false,
            exclude_ambiguous: false,
            exclude_custom: String::new(),
        };
        let d_entropy = digits.entropy_per_char();
        assert!((d_entropy - 10_f64.log2()).abs() < 0.001);

        // Nothing enabled → fallback to lowercase (26 chars)
        let nothing = CharSet {
            uppercase: false,
            lowercase: false,
            digits: false,
            special: false,
            exclude_ambiguous: false,
            exclude_custom: String::new(),
        };
        let n_entropy = nothing.entropy_per_char();
        assert!((n_entropy - 26_f64.log2()).abs() < 0.001);
    }
}
