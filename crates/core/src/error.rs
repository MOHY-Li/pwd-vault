use thiserror::Error;

/// Unified error type for all pwd-vault-core submodules.
#[derive(Error, Debug)]
pub enum VaultError {
    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("invalid master password")]
    InvalidPassword,

    #[error("vault corrupted: {0}")]
    VaultCorrupted(String),

    #[error("entry not found: {0}")]
    EntryNotFound(String),

    #[error("import error: {0}")]
    Import(String),

    #[error("export error: {0}")]
    Export(String),

    #[error("TOTP error: {0}")]
    Totp(String),

    #[error("authentication error: {0}")]
    Authentication(String),

    #[error("Argon2 error: {0}")]
    Argon2(String),
}

/// Convenience type alias used throughout the crate.
pub type Result<T> = std::result::Result<T, VaultError>;
