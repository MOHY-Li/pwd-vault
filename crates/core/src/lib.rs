//! pwd-vault-core — encrypted password vault engine.
//!
//! Provides cryptographic operations, entry management, binary vault file
//! format, and import/export capabilities.

#![allow(clippy::missing_errors_doc)]
#![allow(clippy::missing_panics_doc)]
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::cast_precision_loss)]
#![allow(clippy::cast_sign_loss)]
#![allow(clippy::case_sensitive_file_extension_comparisons)]
#![allow(clippy::float_cmp)]

pub mod error;
pub mod entry;
pub mod crypto;
pub mod generator;
pub mod strength;
pub mod vault;
pub mod vault_index;
pub mod totp;
pub mod import_export;
pub mod audit;
pub mod dedup;
