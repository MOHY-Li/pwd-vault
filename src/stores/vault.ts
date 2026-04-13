/// SolidJS stores for app-wide state management.
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import type { Entry } from "../api";
import * as api from "../api";

// ---------------------------------------------------------------------------
// Auth store
// ---------------------------------------------------------------------------

const [isUnlocked, setIsUnlocked] = createSignal(false);
const [masterPassword, setMasterPassword] = createSignal("");
const [vaultPath, setVaultPath] = createSignal("");

export { isUnlocked, masterPassword, vaultPath };

export async function createVault(password: string, path: string) {
  await api.vaultCreate(password, path);
  setMasterPassword(password);
  setVaultPath(path);
  setIsUnlocked(true);
}

export async function unlockVault(password: string, path: string) {
  await api.vaultOpen(password, path);
  setMasterPassword(password);
  setVaultPath(path);
  setIsUnlocked(true);
  await refreshEntries();
}

export async function lockVault() {
  await api.vaultLock();
  setMasterPassword("");
  setIsUnlocked(false);
  setEntries([]);
}

export async function saveVault() {
  await api.vaultSave(masterPassword());
}

// ---------------------------------------------------------------------------
// Vault entries store
// ---------------------------------------------------------------------------

const [entries, setEntries] = createStore<Entry[]>([]);
export { entries };

export async function refreshEntries() {
  const list = await api.entryList();
  setEntries(list);
}

export async function addEntry(entry: Entry) {
  await api.entryAdd(entry);
  await saveVault();
  await refreshEntries();
}

export async function updateEntry(entry: Entry) {
  await api.entryUpdate(entry);
  await saveVault();
  await refreshEntries();
}

export async function deleteEntry(id: string) {
  await api.entryDelete(id);
  await saveVault();
  await refreshEntries();
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export const [selectedEntryId, setSelectedEntryId] = createSignal<string | null>(null);
export const [searchQuery, setSearchQuery] = createSignal("");
export const [sidebarFilter, setSidebarFilter] = createSignal<"all" | "favorites" | "login" | "note" | "card" | "identity" | "trash">("all");
export const [editingEntry, setEditingEntry] = createSignal<Entry | null>(null);
export const [showGenerator, setShowGenerator] = createSignal(false);
