/// SolidJS stores for app-wide state management.
import { createSignal, createEffect } from "solid-js";
import { createStore } from "solid-js/store";
import type { Entry } from "../api";
import * as api from "../api";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

// ---------------------------------------------------------------------------
// Auth store
// ---------------------------------------------------------------------------

const [isUnlocked, setIsUnlocked] = createSignal(false);
const [vaultPath, setVaultPath] = createSignal("");

export { isUnlocked, vaultPath };

export async function createVault(password: string, path: string) {
  await api.vaultCreate(password, path);
  setVaultPath(path);
  setIsUnlocked(true);
  await refreshEntries();
}

export async function unlockVault(password: string, path: string) {
  await api.vaultOpen(password, path);
  setVaultPath(path);
  setIsUnlocked(true);
  await refreshEntries();
}

export async function lockVault() {
  // C2: Clear auto-lock timer
  if (autoLockTimer) { clearTimeout(autoLockTimer); autoLockTimer = null; }
  try {
    await api.vaultLock();
  } catch (err) {
    console.error("[lockVault] api.vaultLock failed:", err);
  } finally {
    // C1: Remove auto-lock listeners and allow re-registration on next unlock
    if (autoLockHandler) {
      const events = ["mousemove", "keydown", "mousedown", "touchstart"];
      events.forEach(e => document.removeEventListener(e, autoLockHandler!));
      autoLockHandler = null;
    }
    listenersInstalled = false;
    // Always clear frontend state regardless of API error
    setIsUnlocked(false);
    setEntries([]);
    setTrash([]);
    setTotpCodes({});
    setVaultPath("");
    // Clear all UI state to prevent stale modals/signals on re-unlock
    setSelectedEntryId(null);
    setEditingEntry(null);
    setEditingIsNew(false);
    setShowGenerator(false);
    setShowTrash(false);
    setShowAuditLog(false);
    setShowImportExport(false);
    setSearchQuery("");
    setSidebarFilter("all");
  }
}

// ---------------------------------------------------------------------------
// Secure clipboard — auto-clear after 30 seconds
// ---------------------------------------------------------------------------

let clipboardTimer: ReturnType<typeof setTimeout> | null = null;
let clipboardErrorCb: ((msg: string) => void) | null = null;

/** Set a global callback for clipboard error notifications */
export function onClipboardError(cb: (msg: string) => void) {
  clipboardErrorCb = cb;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await writeText(text);
    if (clipboardTimer) clearTimeout(clipboardTimer);
    clipboardTimer = setTimeout(async () => {
      try {
        await writeText("");
      } catch {
        clipboardErrorCb?.("剪贴板自动清除失败，请手动清除");
      }
      clipboardTimer = null;
    }, 30_000);
    return true;
  } catch (err) {
    clipboardErrorCb?.("复制失败，请确保页面处于焦点状态");
    return false;
  }
}

export async function saveVault() {
  await api.vaultSave();
}

// ---------------------------------------------------------------------------
// Vault entries store
// ---------------------------------------------------------------------------

const [entries, setEntries] = createStore<Entry[]>([]);
export { entries };

export async function refreshEntries() {
  try {
    const list = await api.entryList();
    setEntries(list);
  } catch (err) {
    console.error("[refreshEntries] failed:", err);
  }
}

export async function addEntry(entry: Entry): Promise<string> {
  const id = await api.entryAdd(entry);
  await saveVault();
  await refreshEntries();
  return id;
}

export async function updateEntry(entry: Entry) {
  await api.entryUpdate(entry);
  await saveVault();
  await refreshEntries();
}

export async function deleteEntry(id: string) {
  // Clear UI state immediately before async
  if (selectedEntryId() === id) {
    setSelectedEntryId(null);
  }
  try {
    await api.entryDelete(id);
    await saveVault();
    await refreshEntries();
    await refreshTrash();
  } catch (err) {
    console.error("[deleteEntry] failed:", err);
    // Re-throw so callers can show error to user
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Recycle bin store
// ---------------------------------------------------------------------------

const [trash, setTrash] = createStore<Entry[]>([]);
export { trash };

export async function refreshTrash() {
  try {
    const list = await api.trashList();
    setTrash(list);
  } catch (err) {
    console.error("[refreshTrash] failed:", err);
  }
}

export async function restoreEntry(id: string) {
  await api.entryRestore(id);
  await saveVault();
  await refreshEntries();
  await refreshTrash();
}

export async function purgeEntry(id: string) {
  await api.entryPurge(id);
  await saveVault();
  await refreshTrash();
}

export async function emptyTrash() {
  await api.trashEmpty();
  await saveVault();
  setTrash([]);
}

// ---------------------------------------------------------------------------
// TOTP store
// ---------------------------------------------------------------------------

const [totpCodes, setTotpCodes] = createSignal<Record<string, { code: string; remaining: number }>>({});
export { totpCodes };

export async function refreshTotp(entryId: string) {
  try {
    const code = await api.totpGenerate(entryId);
    const remaining = await api.totpTimeRemaining(entryId);
    setTotpCodes((prev) => ({ ...prev, [entryId]: { code, remaining } }));
  } catch (err) {
    // Entry may not have TOTP configured
    console.error("[refreshTotp] failed:", err);
  }
}

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

export const [selectedEntryId, setSelectedEntryId] = createSignal<string | null>(null);
export const [searchQuery, setSearchQuery] = createSignal("");
export const [sidebarFilter, setSidebarFilter] = createSignal<string>("all");
export const [editingEntry, setEditingEntry] = createSignal<Entry | null>(null);
export const [editingIsNew, setEditingIsNew] = createSignal(false);
export const [showGenerator, setShowGenerator] = createSignal(false);
export const [showImportExport, setShowImportExport] = createSignal(false);
export const [showAuditLog, setShowAuditLog] = createSignal(false);
export const [showTrash, setShowTrash] = createSignal(false);

// ---------------------------------------------------------------------------
// Auto-lock timer
// ---------------------------------------------------------------------------

const [autoLockMinutes, setAutoLockMinutes] = createSignal(5);
export { autoLockMinutes, setAutoLockMinutes };

let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;
let autoLockHandler: (() => void) | null = null;

export function resetAutoLockTimer() {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  const mins = autoLockMinutes();
  if (mins > 0 && isUnlocked()) {
    autoLockTimer = setTimeout(() => {
      lockVault();
    }, mins * 60 * 1000);
  }
}

export function setAutoLock(minutes: number) {
  setAutoLockMinutes(minutes);
  resetAutoLockTimer();
}

export function initAutoLockListener() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  const events = ["mousemove", "keydown", "mousedown", "touchstart"];
  const handler = () => resetAutoLockTimer();
  autoLockHandler = handler;
  events.forEach(e => document.addEventListener(e, handler, { passive: true }));
}
