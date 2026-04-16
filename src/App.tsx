import { Show, createEffect, onMount, ErrorBoundary } from "solid-js";
import { isUnlocked, initAutoLockListener } from "./stores/vault";
import LockScreen from "./components/auth/LockScreen";
import MainLayout from "./components/layout/MainLayout";

function ErrorFallback(err: unknown, reset: () => void) {
  return (
    <div class="flex h-screen w-screen items-center justify-center bg-zinc-900 text-zinc-100">
      <div class="max-w-md rounded-xl border border-red-500/30 bg-zinc-800 p-6 text-center">
        <h2 class="text-lg font-bold text-red-400">渲染错误</h2>
        <p class="mt-2 text-sm text-zinc-400">{String(err)}</p>
        <button
          onClick={reset}
          class="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-500"
        >
          重试
        </button>
      </div>
    </div>
  );
}

export default function App() {
  // Prevent Tauri webview from navigating on file drag-drop
  onMount(() => {
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => e.preventDefault());
  });

  // Initialize auto-lock listener once when the vault is unlocked
  createEffect(() => {
    if (isUnlocked()) {
      initAutoLockListener();
    }
  });

  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <div class="flex h-screen w-screen overflow-hidden bg-zinc-900 text-zinc-100">
        <Show
          when={isUnlocked()}
          fallback={<LockScreen />}
        >
          <MainLayout />
        </Show>
      </div>
    </ErrorBoundary>
  );
}
