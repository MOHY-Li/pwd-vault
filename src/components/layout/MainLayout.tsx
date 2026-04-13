import { Show } from "solid-js";
import Sidebar from "./Sidebar";
import MainContent from "../vault/MainContent";
import EntryEditor from "../vault/EntryEditor";
import PasswordGen from "../generator/PasswordGen";
import Trash from "../vault/Trash";
import AuditLog from "../vault/AuditLog";
import ImportExport from "../import-export/ImportExport";
import { editingEntry, showGenerator, showTrash, showAuditLog, showImportExport } from "../../stores/vault";

export default function MainLayout() {
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
