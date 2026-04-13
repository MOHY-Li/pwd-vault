/// Tauri IPC invoke wrappers — typed API for all Rust commands.
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Entry {
  id: string;
  entry_type: "login" | "note" | "card" | "identity";
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  totp: TotpConfig | null;
  custom_fields: CustomField[];
  tags: string[];
  folder: string | null;
  favorite: boolean;
  created: string;
  modified: string;
  password_history: PasswordHistoryEntry[];
}

export interface TotpConfig {
  secret: string;
  algorithm: "sha1" | "sha256" | "sha512";
  digits: number;
  period: number;
}

export interface CustomField {
  name: string;
  value: string;
  field_type: "text" | "password" | "hidden";
}

export interface PasswordHistoryEntry {
  password: string;
  changed_at: string;
}

export interface StrengthReport {
  score: number;
  entropy: number;
  crack_time: string;
  label: string;
}

export interface AuditEntry {
  timestamp: string;
  event_type: AuditEvent;
}

export type AuditEvent =
  | { VaultCreated: void }
  | { VaultOpened: void }
  | { VaultLocked: void }
  | { EntryViewed: { entry_id: string } }
  | { EntryCreated: { entry_id: string } }
  | { EntryUpdated: { entry_id: string } }
  | { EntryDeleted: { entry_id: string } }
  | { PasswordCopied: { entry_id: string } }
  | { DataExported: void }
  | { DataImported: { count: number } };

// ---------------------------------------------------------------------------
// Vault lifecycle
// ---------------------------------------------------------------------------

export async function vaultCreate(masterPassword: string, path: string): Promise<void> {
  await invoke("vault_create", { masterPassword, path });
}

export async function vaultOpen(masterPassword: string, path: string): Promise<void> {
  await invoke("vault_open", { masterPassword, path });
}

export async function vaultSave(masterPassword: string): Promise<void> {
  await invoke("vault_save", { masterPassword });
}

export async function vaultLock(): Promise<void> {
  await invoke("vault_lock");
}

export async function vaultIsOpen(): Promise<boolean> {
  return await invoke("vault_is_open");
}

// ---------------------------------------------------------------------------
// Entry CRUD
// ---------------------------------------------------------------------------

export async function entryAdd(entry: Entry): Promise<string> {
  return await invoke<string>("entry_add", { entryJson: JSON.stringify(entry) });
}

export async function entryUpdate(entry: Entry): Promise<void> {
  await invoke("entry_update", { entryJson: JSON.stringify(entry) });
}

export async function entryDelete(id: string): Promise<void> {
  await invoke("entry_delete", { id });
}

export async function entryGet(id: string): Promise<Entry | null> {
  const raw = await invoke<string | null>("entry_get", { id });
  return raw ? JSON.parse(raw) : null;
}

export async function entryList(): Promise<Entry[]> {
  const raw = await invoke<string>("entry_list");
  return JSON.parse(raw);
}

export async function entrySearch(query: string): Promise<Entry[]> {
  const raw = await invoke<string>("entry_search", { query });
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export async function generatePassword(opts: {
  style: "random" | "diceware";
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  digits?: boolean;
  special?: boolean;
  excludeAmbiguous?: boolean;
  separator?: string;
  wordCount?: number;
}): Promise<string> {
  return await invoke<string>("generate_password", {
    style: opts.style,
    length: opts.length ?? 20,
    uppercase: opts.uppercase ?? true,
    lowercase: opts.lowercase ?? true,
    digits: opts.digits ?? true,
    special: opts.special ?? true,
    excludeAmbiguous: opts.excludeAmbiguous ?? false,
    separator: opts.separator ?? "-",
    wordCount: opts.wordCount ?? 5,
  });
}

export async function evaluateStrength(password: string): Promise<StrengthReport> {
  const raw = await invoke<string>("evaluate_strength", { password });
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

export async function totpGenerate(entryId: string): Promise<string> {
  return await invoke<string>("totp_generate", { entryId });
}

export async function totpTimeRemaining(entryId: string): Promise<number> {
  return await invoke<number>("totp_time_remaining", { entryId });
}

export async function totpParseUri(uri: string): Promise<TotpConfig> {
  const raw = await invoke<string>("totp_parse_uri", { uri });
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Import / Export
// ---------------------------------------------------------------------------

export async function vaultImport(format: string, data: string): Promise<number> {
  const count = await invoke<string>("vault_import", { format, data });
  return parseInt(count, 10);
}

export async function vaultExport(format: string): Promise<string> {
  return await invoke<string>("vault_export", { format });
}

export async function detectImportFormat(data: string, filename?: string): Promise<string> {
  return await invoke<string>("detect_import_format", { data, filename: filename ?? null });
}

// ---------------------------------------------------------------------------
// Recycle bin
// ---------------------------------------------------------------------------

export async function trashList(): Promise<Entry[]> {
  const raw = await invoke<string>("trash_list");
  return JSON.parse(raw);
}

export async function entryRestore(id: string): Promise<void> {
  await invoke("entry_restore", { id });
}

export async function entryPurge(id: string): Promise<void> {
  await invoke("entry_purge", { id });
}

export async function trashEmpty(): Promise<void> {
  await invoke("trash_empty");
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function auditRecent(count: number): Promise<AuditEntry[]> {
  const raw = await invoke<string>("audit_recent", { count });
  return JSON.parse(raw);
}
