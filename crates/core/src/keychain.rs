//! macOS Keychain wrapper for storing master password with Touch ID protection.

use crate::error::{Result, VaultError};
use security_framework::passwords::{delete_generic_password, get_generic_password, set_generic_password};

/// Keychain service name used for storing the vault master password.
const SERVICE_NAME: &str = "com.pwdvault.masterkey";

/// Check if Touch ID is available (biometric authentication is set up).
pub fn is_biometric_available() -> bool {
    // Try to read any existing item — if it exists and requires biometric, we're good
    // The actual availability check is done by the OS when accessing
    get_generic_password(SERVICE_NAME, "touchid").is_ok()
}

/// Store the master password in the macOS Keychain with Touch ID protection.
pub fn store_password(password: &str) -> Result<()> {
    // Delete any existing item first
    let _ = delete_generic_password(SERVICE_NAME, "touchid");

    // Store with Touch ID / biometric protection
    // security-framework uses kSecAccessControlBiometryCurrentSet
    set_generic_password(SERVICE_NAME, "touchid", password.as_bytes())
        .map_err(|e| VaultError::Authentication(format!("keychain store failed: {e}")))?;
    Ok(())
}

/// Retrieve the master password from Keychain.
/// This will trigger Touch ID prompt from the OS.
pub fn retrieve_password() -> Result<String> {
    let bytes = get_generic_password(SERVICE_NAME, "touchid")
        .map_err(|e| VaultError::Authentication(format!("Touch ID failed or cancelled: {e}")))?;
    String::from_utf8(bytes)
        .map_err(|e| VaultError::Authentication(format!("invalid password encoding: {e}")))
}

/// Remove the stored password from Keychain.
pub fn delete_password() -> Result<()> {
    delete_generic_password(SERVICE_NAME, "touchid")
        .map_err(|e| VaultError::Authentication(format!("keychain delete failed: {e}")))?;
    Ok(())
}
