//! Cryptographic operations for pwd-vault.
//!
//! Provides key derivation (Argon2id, HKDF-SHA256), authenticated encryption
//! (XChaCha20-Poly1305), MAC computation (BLAKE3), and related utilities.

use crate::error::{Result, VaultError};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use zeroize::{Zeroize, ZeroizeOnDrop};

// ---------------------------------------------------------------------------
// MasterKey newtype
// ---------------------------------------------------------------------------

/// The 256-bit master key derived from the user's password via Argon2id.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; 32]);

impl MasterKey {
    pub fn new(key: [u8; 32]) -> Self {
        Self(key)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

// ---------------------------------------------------------------------------
// EncryptedData — serialisable ciphertext container
// ---------------------------------------------------------------------------

/// Authenticated-encrypted payload produced by [`encrypt`].
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct EncryptedData {
    pub nonce: [u8; 24],
    pub ciphertext: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Salt / random generation
// ---------------------------------------------------------------------------

/// Generate a cryptographically random 32-byte salt.
pub fn generate_salt() -> [u8; 32] {
    let mut salt = [0u8; 32];
    getrandom::fill(&mut salt).expect("failed to generate random salt");
    salt
}

/// Generate a cryptographically random 24-byte nonce for XChaCha20-Poly1305.
fn generate_nonce() -> [u8; 24] {
    let mut nonce = [0u8; 24];
    getrandom::fill(&mut nonce).expect("failed to generate random nonce");
    nonce
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/// Derive the master key from a password and salt using Argon2id.
///
/// Parameters: 256 MiB memory, 4 iterations, parallelism 4.
/// The password bytes are zeroised after use.
pub fn derive_master_key(password: &str, salt: &[u8; 32]) -> Result<MasterKey> {
    let params = Params::new(256 * 1024, 4, 4, Some(32))
        .map_err(|e| VaultError::Crypto(format!("invalid Argon2 params: {e}")))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; 32];
    // Convert password to bytes; zeroise afterwards.
    let mut password_bytes = password.as_bytes().to_vec();

    let result = argon2.hash_password_into(&password_bytes, salt, &mut key);
    password_bytes.zeroize();

    result.map_err(|e| VaultError::Argon2(e.to_string()))?;

    Ok(MasterKey::new(key))
}

/// Derive a 256-bit authentication hash from the master key (HKDF-SHA256).
pub fn derive_auth_hash(master_key: &MasterKey) -> [u8; 32] {
    let hkdf: Hkdf<Sha256> = Hkdf::new(None, master_key.as_bytes());
    let mut out = [0u8; 32];
    hkdf.expand(b"pwd-vault-auth-hash", &mut out)
        .expect("32 bytes is a valid HKDF output length");
    out
}

/// Derive a 256-bit vault encryption key from the master key (HKDF-SHA256).
pub fn derive_vault_key(master_key: &MasterKey) -> [u8; 32] {
    let hkdf: Hkdf<Sha256> = Hkdf::new(None, master_key.as_bytes());
    let mut out = [0u8; 32];
    hkdf.expand(b"pwd-vault-vault-key", &mut out)
        .expect("32 bytes is a valid HKDF output length");
    out
}

/// Derive a per-entry encryption key from a key seed and entry identifier
/// (HKDF-SHA256 with entry_id as info).
pub fn derive_entry_key(key_seed: &[u8; 32], entry_id: &[u8]) -> [u8; 32] {
    let hkdf: Hkdf<Sha256> = Hkdf::new(None, key_seed);
    let mut out = [0u8; 32];
    hkdf.expand(entry_id, &mut out)
        .expect("32 bytes is a valid HKDF output length");
    out
}

// ---------------------------------------------------------------------------
// Authenticated encryption — XChaCha20-Poly1305
// ---------------------------------------------------------------------------

/// Encrypt `data` with a 256-bit key using XChaCha20-Poly1305.
///
/// A random 24-byte nonce is generated for each call.
pub fn encrypt(data: &[u8], key: &[u8; 32]) -> Result<EncryptedData> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| VaultError::Crypto(format!("invalid key length: {e}")))?;

    let nonce = generate_nonce();
    let nonce_obj = XNonce::from(nonce);

    let ciphertext = cipher
        .encrypt(&nonce_obj, data)
        .map_err(|e| VaultError::Crypto(format!("encryption failed: {e}")))?;

    Ok(EncryptedData { nonce, ciphertext })
}

/// Decrypt an [`EncryptedData`] payload with the given 256-bit key.
pub fn decrypt(encrypted: &EncryptedData, key: &[u8; 32]) -> Result<Vec<u8>> {
    let cipher = XChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| VaultError::Crypto(format!("invalid key length: {e}")))?;

    let nonce_obj = XNonce::from(encrypted.nonce);

    cipher
        .decrypt(&nonce_obj, encrypted.ciphertext.as_ref())
        .map_err(|e| VaultError::Crypto(format!("decryption failed: {e}")))
}

// ---------------------------------------------------------------------------
// Password verification
// ---------------------------------------------------------------------------

/// Verify a password against a stored salt and authentication hash.
///
/// Uses constant-time comparison to prevent timing attacks.
pub fn verify_password(
    password: &str,
    salt: &[u8; 32],
    stored_auth_hash: &[u8; 32],
) -> Result<bool> {
    let master_key = derive_master_key(password, salt)?;
    let computed = derive_auth_hash(&master_key);
    Ok(computed.ct_eq(stored_auth_hash).into())
}

// ---------------------------------------------------------------------------
// MAC — BLAKE3
// ---------------------------------------------------------------------------

/// Compute a BLAKE3 MAC over arbitrary data.
pub fn compute_mac(data: &[u8]) -> [u8; 32] {
    *blake3::hash(data).as_bytes()
}

/// Verify data against an expected BLAKE3 MAC using constant-time comparison.
pub fn verify_mac(data: &[u8], expected: &[u8; 32]) -> bool {
    let computed = compute_mac(data);
    computed.ct_eq(expected).into()
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PASSWORD: &str = "correct-horse-battery-staple";
    const TEST_SALT: [u8; 32] = [0xAB; 32];
    const TEST_KEY: [u8; 32] = [0x42; 32];

    // ---- encrypt / decrypt roundtrip ----

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let plaintext = b"hello, world!";
        let encrypted = encrypt(plaintext, &TEST_KEY).unwrap();
        let decrypted = decrypt(&encrypted, &TEST_KEY).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn wrong_key_fails() {
        let plaintext = b"secret data";
        let encrypted = encrypt(plaintext, &TEST_KEY).unwrap();

        let wrong_key = [0xFF; 32];
        let result = decrypt(&encrypted, &wrong_key);
        assert!(result.is_err());
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let plaintext = b"important message";
        let mut encrypted = encrypt(plaintext, &TEST_KEY).unwrap();

        // Flip a byte in the ciphertext
        if !encrypted.ciphertext.is_empty() {
            encrypted.ciphertext[0] ^= 0xFF;
        }
        let result = decrypt(&encrypted, &TEST_KEY);
        assert!(result.is_err());
    }

    #[test]
    fn tampered_nonce_fails() {
        let plaintext = b"another message";
        let mut encrypted = encrypt(plaintext, &TEST_KEY).unwrap();

        // Flip a byte in the nonce
        encrypted.nonce[0] ^= 0xFF;
        let result = decrypt(&encrypted, &TEST_KEY);
        assert!(result.is_err());
    }

    // ---- key derivation ----

    #[test]
    fn key_derivation_deterministic() {
        let key1 = derive_master_key(TEST_PASSWORD, &TEST_SALT).unwrap();
        let key2 = derive_master_key(TEST_PASSWORD, &TEST_SALT).unwrap();
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn different_salts_produce_different_keys() {
        let salt_a = [0x01; 32];
        let salt_b = [0x02; 32];

        let key_a = derive_master_key(TEST_PASSWORD, &salt_a).unwrap();
        let key_b = derive_master_key(TEST_PASSWORD, &salt_b).unwrap();
        assert_ne!(key_a.as_bytes(), key_b.as_bytes());
    }

    #[test]
    fn different_passwords_produce_different_keys() {
        let key_a = derive_master_key("password-one", &TEST_SALT).unwrap();
        let key_b = derive_master_key("password-two", &TEST_SALT).unwrap();
        assert_ne!(key_a.as_bytes(), key_b.as_bytes());
    }

    // ---- auth / vault key derivation ----

    #[test]
    fn derive_auth_hash_deterministic() {
        let mk = derive_master_key(TEST_PASSWORD, &TEST_SALT).unwrap();
        let h1 = derive_auth_hash(&mk);
        let h2 = derive_auth_hash(&mk);
        assert_eq!(h1, h2);
    }

    #[test]
    fn derive_vault_key_deterministic() {
        let mk = derive_master_key(TEST_PASSWORD, &TEST_SALT).unwrap();
        let k1 = derive_vault_key(&mk);
        let k2 = derive_vault_key(&mk);
        assert_eq!(k1, k2);
    }

    #[test]
    fn auth_hash_differs_from_vault_key() {
        let mk = derive_master_key(TEST_PASSWORD, &TEST_SALT).unwrap();
        let auth = derive_auth_hash(&mk);
        let vault = derive_vault_key(&mk);
        assert_ne!(auth, vault);
    }

    // ---- entry key derivation ----

    #[test]
    fn derive_entry_key_deterministic() {
        let seed = [0x55; 32];
        let k1 = derive_entry_key(&seed, b"entry-123");
        let k2 = derive_entry_key(&seed, b"entry-123");
        assert_eq!(k1, k2);
    }

    #[test]
    fn different_entry_ids_produce_different_keys() {
        let seed = [0x55; 32];
        let k1 = derive_entry_key(&seed, b"entry-123");
        let k2 = derive_entry_key(&seed, b"entry-456");
        assert_ne!(k1, k2);
    }

    // ---- password verification ----

    #[test]
    fn verify_password_correct() {
        let salt = generate_salt();
        let mk = derive_master_key(TEST_PASSWORD, &salt).unwrap();
        let auth_hash = derive_auth_hash(&mk);

        assert!(verify_password(TEST_PASSWORD, &salt, &auth_hash).unwrap());
    }

    #[test]
    fn verify_password_wrong() {
        let salt = generate_salt();
        let mk = derive_master_key(TEST_PASSWORD, &salt).unwrap();
        let auth_hash = derive_auth_hash(&mk);

        assert!(!verify_password("wrong-password", &salt, &auth_hash).unwrap());
    }

    // ---- MAC ----

    #[test]
    fn compute_mac_deterministic() {
        let data = b"some data to mac";
        let m1 = compute_mac(data);
        let m2 = compute_mac(data);
        assert_eq!(m1, m2);
    }

    #[test]
    fn verify_mac_correct() {
        let data = b"some data to mac";
        let mac = compute_mac(data);
        assert!(verify_mac(data, &mac));
    }

    #[test]
    fn verify_mac_wrong_data() {
        let data = b"some data to mac";
        let mac = compute_mac(data);
        assert!(!verify_mac(b"tampered data", &mac));
    }

    #[test]
    fn verify_mac_wrong_expected() {
        let data = b"some data to mac";
        let _mac = compute_mac(data);
        let wrong_mac = [0u8; 32];
        assert!(!verify_mac(data, &wrong_mac));
    }

    // ---- salt generation uniqueness ----

    #[test]
    fn generate_salt_unique() {
        let s1 = generate_salt();
        let s2 = generate_salt();
        assert_ne!(s1, s2);
    }

    // ---- empty data encrypt/decrypt ----

    #[test]
    fn encrypt_decrypt_empty() {
        let encrypted = encrypt(b"", &TEST_KEY).unwrap();
        let decrypted = decrypt(&encrypted, &TEST_KEY).unwrap();
        assert!(decrypted.is_empty());
    }

    // ---- large data encrypt/decrypt ----

    #[test]
    fn encrypt_decrypt_large() {
        let data = vec![0xAA; 1_000_000]; // 1 MiB
        let encrypted = encrypt(&data, &TEST_KEY).unwrap();
        let decrypted = decrypt(&encrypted, &TEST_KEY).unwrap();
        assert_eq!(decrypted, data);
    }
}
