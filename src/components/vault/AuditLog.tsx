import { For, Show, createSignal } from "solid-js";
import { auditRecent } from "../../api";
import type { AuditEntry } from "../../api";
import { showAuditLog, setShowAuditLog } from "../../stores/vault";

export default function AuditLog() {
  const [entries, setEntries] = createSignal<AuditEntry[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  async function loadEntries() {
    const list = await auditRecent(100);
    setEntries(list);
    setLoaded(true);
  }

  function formatEvent(entry: AuditEntry): string {
    const e = entry.event_type;
    if ("VaultCreated" in e) return "🔐 创建密码库";
    if ("VaultOpened" in e) return "🔓 打开密码库";
    if ("VaultLocked" in e) return "🔒 锁定密码库";
    if ("EntryCreated" in e) return `➕ 创建条目 ${e.EntryCreated.entry_id.slice(0, 8)}...`;
    if ("EntryUpdated" in e) return `✏️ 更新条目 ${e.EntryUpdated.entry_id.slice(0, 8)}...`;
    if ("EntryDeleted" in e) return `🗑️ 删除条目 ${e.EntryDeleted.entry_id.slice(0, 8)}...`;
    if ("PasswordCopied" in e) return `📋 复制密码 ${e.PasswordCopied.entry_id.slice(0, 8)}...`;
    if ("DataExported" in e) return "📤 导出数据";
    if ("DataImported" in e) return `📥 导入数据 (${e.DataImported.count} 条)`;
    return "未知操作";
  }

  function formatTime(ts: string): string {
    return new Date(ts).toLocaleString("zh-CN");
  }

  // Load on first render
  if (showAuditLog() && !loaded()) {
    loadEntries();
  }

  return (
    <Show when={showAuditLog()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-zinc-800 p-4">
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-bold">📋 审计日志</h3>
              <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                {entries().length} 条记录
              </span>
            </div>
            <button
              onClick={() => setShowAuditLog(false)}
              class="text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          {/* Entries */}
          <div class="flex-1 overflow-y-auto p-4">
            <Show when={entries().length === 0 && loaded()}>
              <div class="py-12 text-center text-zinc-600">
                <div class="text-4xl">📋</div>
                <p class="mt-2">暂无审计记录</p>
              </div>
            </Show>

            <div class="space-y-1">
              <For each={entries()}>
                {(entry) => (
                  <div class="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-zinc-800/50">
                    <div class="min-w-0 flex-1">
                      <div class="text-sm text-zinc-200">{formatEvent(entry)}</div>
                      <div class="text-xs text-zinc-500">{formatTime(entry.timestamp)}</div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Footer */}
          <div class="border-t border-zinc-800 p-3">
            <button
              onClick={loadEntries}
              class="w-full rounded-lg bg-zinc-800 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              🔄 刷新
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
