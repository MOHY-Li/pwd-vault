import { For, Show, createSignal } from "solid-js";
import { trash, showTrash, setShowTrash, refreshTrash, restoreEntry, purgeEntry, emptyTrash } from "../../stores/vault";
import type { Entry } from "../../api";

const typeIcon: Record<Entry["entry_type"], string> = {
  login: "🔑",
  note: "📝",
  card: "💳",
  identity: "🪪",
};

const typeLabel: Record<Entry["entry_type"], string> = {
  login: "登录",
  note: "笔记",
  card: "支付卡",
  identity: "身份",
};

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Trash() {
  const [confirmPurgeId, setConfirmPurgeId] = createSignal<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  async function handleRestore(id: string) {
    setBusy(true);
    try {
      await restoreEntry(id);
    } finally {
      setBusy(false);
    }
  }

  async function handlePurge(id: string) {
    setBusy(true);
    try {
      await purgeEntry(id);
      setConfirmPurgeId(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleEmpty() {
    setBusy(true);
    try {
      await emptyTrash();
      setConfirmEmpty(false);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setShowTrash(false);
    setConfirmPurgeId(null);
    setConfirmEmpty(false);
  }

  return (
    <Show when={showTrash()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
            <div class="flex items-center gap-3">
              <h3 class="text-lg font-bold text-zinc-100">🗑️ 回收站</h3>
              <span class="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
                {trash.length} 个条目
              </span>
            </div>
            <button
              onClick={close}
              class="text-zinc-500 transition-colors hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-6 py-4">
            <Show
              when={trash.length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <span class="mb-3 text-5xl">♻️</span>
                  <p class="text-sm">回收站是空的</p>
                </div>
              }
            >
              <div class="space-y-2">
                <For each={trash}>
                  {(entry) => (
                    <div class="group rounded-lg border border-zinc-800 bg-zinc-800/50 p-3 transition-colors hover:border-zinc-700">
                      <div class="flex items-start gap-3">
                        {/* Icon */}
                        <span class="mt-0.5 text-lg">{typeIcon[entry.entry_type]}</span>

                        {/* Info */}
                        <div class="min-w-0 flex-1">
                          <p class="truncate text-sm font-medium text-zinc-100">
                            {entry.title}
                          </p>
                          <p class="truncate text-xs text-zinc-400">
                            {entry.username || typeLabel[entry.entry_type]}
                          </p>
                          <p class="mt-0.5 text-xs text-zinc-500">
                            删除于 {formatDate(entry.modified)}
                          </p>
                        </div>

                        {/* Actions */}
                        <div class="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => handleRestore(entry.id)}
                            disabled={busy()}
                            class="rounded-md bg-emerald-600/20 px-2.5 py-1 text-xs font-medium text-emerald-400 transition-colors hover:bg-emerald-600/30 disabled:opacity-50"
                          >
                            恢复
                          </button>

                          <Show
                            when={confirmPurgeId() === entry.id}
                            fallback={
                              <button
                                onClick={() => setConfirmPurgeId(entry.id)}
                                disabled={busy()}
                                class="rounded-md bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-600/30 disabled:opacity-50"
                              >
                                永久删除
                              </button>
                            }
                          >
                            <div class="flex items-center gap-1">
                              <button
                                onClick={() => handlePurge(entry.id)}
                                disabled={busy()}
                                class="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setConfirmPurgeId(null)}
                                class="rounded-md bg-zinc-700 px-2 py-1 text-xs text-zinc-400 transition-colors hover:text-zinc-200"
                              >
                                取消
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <Show when={trash.length > 0}>
            <div class="border-t border-zinc-800 px-6 py-4">
              <Show
                when={confirmEmpty()}
                fallback={
                  <button
                    onClick={() => setConfirmEmpty(true)}
                    disabled={busy()}
                    class="w-full rounded-lg bg-zinc-800 py-2.5 text-sm font-medium text-red-400 transition-colors hover:bg-zinc-700 hover:text-red-300 disabled:opacity-50"
                  >
                    清空回收站
                  </button>
                }
              >
                <div class="flex items-center gap-3">
                  <p class="text-xs text-zinc-400">确定要永久删除所有条目吗？此操作不可撤销。</p>
                  <button
                    onClick={handleEmpty}
                    disabled={busy()}
                    class="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
                  >
                    确认清空
                  </button>
                  <button
                    onClick={() => setConfirmEmpty(false)}
                    class="shrink-0 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    取消
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
