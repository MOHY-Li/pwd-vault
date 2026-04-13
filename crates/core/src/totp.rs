use crate::entry::{TotpAlgorithm, TotpConfig};
use crate::error::{Result, VaultError};

/// Map our algorithm enum to the totp-rs equivalent.
fn to_totp_rs_algorithm(algo: &TotpAlgorithm) -> totp_rs::Algorithm {
    match algo {
        TotpAlgorithm::Sha1 => totp_rs::Algorithm::SHA1,
        TotpAlgorithm::Sha256 => totp_rs::Algorithm::SHA256,
        TotpAlgorithm::Sha512 => totp_rs::Algorithm::SHA512,
    }
}

/// Map the totp-rs algorithm enum back to ours.
fn from_totp_rs_algorithm(algo: totp_rs::Algorithm) -> TotpAlgorithm {
    match algo {
        totp_rs::Algorithm::SHA1 => TotpAlgorithm::Sha1,
        totp_rs::Algorithm::SHA256 => TotpAlgorithm::Sha256,
        totp_rs::Algorithm::SHA512 => TotpAlgorithm::Sha512,
    }
}

/// Generate the current TOTP code for the given configuration.
///
/// Returns a zero-padded numeric string whose length equals `config.digits`.
pub fn generate_totp(config: &TotpConfig) -> Result<String> {
    let algorithm = to_totp_rs_algorithm(&config.algorithm);
    let secret = totp_rs::Secret::Encoded(config.secret.clone())
        .to_bytes()
        .map_err(|e| VaultError::Totp(format!("invalid base32 secret: {e}")))?;

    let totp = totp_rs::TOTP::new_unchecked(
        algorithm,
        config.digits as usize,
        1, // skew: allow ±1 step for clock drift
        u64::from(config.period),
        secret,
        None,           // issuer – not needed for generation
        String::new(),  // account_name – not needed for generation
    );

    let code = totp
        .generate_current()
        .map_err(|e| VaultError::Totp(format!("failed to generate TOTP: {e}")))?;

    Ok(code)
}

/// Return the number of seconds remaining until the current TOTP code expires.
///
/// The value is always in `1..=config.period`.
#[must_use] 
pub fn time_remaining(config: &TotpConfig) -> u32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let period = u64::from(config.period);
    let remaining = period - (secs % period);
    remaining as u32
}

/// Parse an `otpauth://totp/` URI into a `TotpConfig`.
///
/// Expected format:
/// ```text
/// otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30
/// ```
///
/// `algorithm`, `digits`, `period`, and `issuer` are optional and fall back to
/// sensible defaults when absent.
pub fn parse_totp_uri(uri: &str) -> Result<TotpConfig> {
    let totp = totp_rs::TOTP::from_url_unchecked(uri)
        .map_err(|e| VaultError::Totp(format!("failed to parse otpauth URI: {e}")))?;

    Ok(TotpConfig {
        secret: totp.get_secret_base32(),
        algorithm: from_totp_rs_algorithm(totp.algorithm),
        digits: totp.digits as u32, // max 8, safe truncation
        period: totp.step as u32,   // typically 30, safe truncation
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> TotpConfig {
        TotpConfig {
            // "Hello!" in Base32
            secret: "JBSWY3DPEHPK3PXP".to_string(),
            algorithm: TotpAlgorithm::Sha1,
            digits: 6,
            period: 30,
        }
    }

    #[test]
    fn test_generate_totp() {
        let config = sample_config();
        let code = generate_totp(&config).expect("TOTP generation should succeed");

        // The code must be exactly `digits` characters long and all numeric.
        assert_eq!(
            code.len(),
            config.digits as usize,
            "code length should match configured digits"
        );
        assert!(
            code.chars().all(|c| c.is_ascii_digit()),
            "code should be all digits: {code}"
        );
    }

    #[test]
    fn test_time_remaining() {
        let config = sample_config();
        let remaining = time_remaining(&config);

        assert!(
            remaining >= 1 && remaining <= config.period,
            "time_remaining ({remaining}) should be in 1..={}",
            config.period
        );
    }

    #[test]
    fn test_parse_totp_uri() {
        let uri = "otpauth://totp/Example:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example&algorithm=SHA1&digits=6&period=30";
        let config = parse_totp_uri(uri).expect("URI parsing should succeed");

        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(config.algorithm, TotpAlgorithm::Sha1);
        assert_eq!(config.digits, 6);
        assert_eq!(config.period, 30);
    }

    #[test]
    fn test_parse_totp_uri_defaults() {
        // URI with only the required `secret` parameter – all others should
        // fall back to the totp-rs defaults.
        let uri = "otpauth://totp/user@example.com?secret=JBSWY3DPEHPK3PXP";
        let config = parse_totp_uri(uri).expect("URI parsing should succeed");

        assert_eq!(config.secret, "JBSWY3DPEHPK3PXP");
        // totp-rs defaults: SHA1, 6 digits, 30-second period
        assert_eq!(config.algorithm, TotpAlgorithm::Sha1);
        assert_eq!(config.digits, 6);
        assert_eq!(config.period, 30);
    }
}
