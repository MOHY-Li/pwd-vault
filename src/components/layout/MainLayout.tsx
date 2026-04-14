import { Show, onMount, onCleanup } from "solid-js";
import Sidebar from "./Sidebar";
import MainContent from "../vault/MainContent";
import EntryEditor from "../vault/EntryEditor";
import PasswordGen from "../generator/PasswordGen";
import Trash from "../vault/Trash";
import AuditLog from "../vault/AuditLog";
import ImportExport from "../import-export/ImportExport";
import {
  editingEntry,
  setEditingEntry,
  setEditingIsNew,
  showGenerator,
  setShowGenerator,
  showTrash,
  setShowTrash,
  showAuditLog,
  setShowAuditLog,
  showImportExport,
  setShowImportExport,
  isUnlocked,
  lockVault,
} from "../../stores/vault";
import type { Entry } from "../../api";

export default function MainLayout() {
  function handleKeyDown(e: KeyboardEvent) {
    if (!isUnlocked()) return;

    const mod = e.metaKey || e.ctrlKey;

    // Ctrl/Cmd + F — focus search
    if (mod && e.key === "f") {
      e.preventDefault();
      const input = document.querySelector('input[placeholder*="搜索"]') as HTMLInputElement | null;
      input?.focus();
      return;
    }

    // Ctrl/Cmd + N — new entry
    if (mod && e.key === "n") {
      e.preventDefault();
      const empty: Entry = {
        id: crypto.randomUUID(),
        entry_type: "login",
        title: "",
        username: "",
        password: "",
        url: "",
        notes: "",
        totp: null,
        custom_fields: [],
        tags: [],
        folder: null,
        favorite: false,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        password_history: [],
      };
      setEditingIsNew(true);
      setEditingEntry(empty);
      return;
    }

    // Ctrl/Cmd + L — lock vault
    if (mod && e.key === "l") {
      e.preventDefault();
      lockVault();
      return;
    }

    // Escape — close any open modal
    if (e.key === "Escape") {
      let closed = false;
      if (editingEntry()) {
        setEditingEntry(null);
        closed = true;
      }
      if (showGenerator()) {
        setShowGenerator(false);
        closed = true;
      }
      if (showTrash()) {
        setShowTrash(false);
        closed = true;
      }
      if (showAuditLog()) {
        setShowAuditLog(false);
        closed = true;
      }
      if (showImportExport()) {
        setShowImportExport(false);
        closed = true;
      }
      if (closed) {
        e.preventDefault();
      }
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <>
      <Sidebar />
      <MainContent />
      {/* Modal overlays */}
      <Show when={editingEntry()}>
        <EntryEditor />
      </Show>
      <Show when={showGenerator()}>
        <PasswordGen />
      </Show>
      <Show when={showTrash()}>
        <Trash />
      </Show>
      <Show when={showAuditLog()}>
        <AuditLog />
      </Show>
      <Show when={showImportExport()}>
        <ImportExport />
      </Show>
    </>
  );
}
