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

pub mod audit;
pub mod crypto;
pub mod dedup;
pub mod entry;
pub mod error;
pub mod generator;
pub mod import_export;
pub mod strength;
pub mod totp;
pub mod vault;
pub mod vault_index;
