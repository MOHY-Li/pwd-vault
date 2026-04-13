import { Show } from "solid-js";
import Sidebar from "./Sidebar";
import MainContent from "../vault/MainContent";
import EntryEditor from "../vault/EntryEditor";
import PasswordGen from "../generator/PasswordGen";
import { editingEntry, showGenerator } from "../../stores/vault";

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
    </>
  );
}
