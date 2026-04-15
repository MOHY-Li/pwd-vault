import { Show, createEffect, onMount } from "solid-js";
import { isUnlocked, initAutoLockListener } from "./stores/vault";
import LockScreen from "./components/auth/LockScreen";
import MainLayout from "./components/layout/MainLayout";

export default function App() {
  // Prevent Tauri webview from navigating on file drag-drop
  onMount(() => {
    document.addEventListener("dragover", (e) => e.preventDefault());
  });

  // Initialize auto-lock listener once when the vault is unlocked
  let listenerInitialized = false;
  createEffect(() => {
    if (isUnlocked() && !listenerInitialized) {
      listenerInitialized = true;
      initAutoLockListener();
    }
  });

  return (
    <div class="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
      <Show
        when={isUnlocked()}
        fallback={<LockScreen />}
      >
        <MainLayout />
      </Show>
    </div>
  );
}
