import { Show, createSignal } from "solid-js";
import { entries, selectedEntryId, setEditingEntry, deleteEntry, saveVault } from "../../stores/vault";
import EntryEditor from "../vault/EntryEditor";
import PasswordGen from "../generator/PasswordGen";

export default function MainContent() {
  const [showPassword, setShowPassword] = createSignal(false);
  const [copied, setCopied] = createSignal("");

  const selectedEntry = () => entries.find((e) => e.id === selectedEntryId());

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(""), 2000);
  }

  const entryTypeLabel = (type: string) => {
    switch (type) {
      case "login": return "登录";
      case "note": return "笔记";
      case "card": return "支付卡";
      case "identity": return "身份";
      default: return type;
    }
  };

  return (
    <div class="flex flex-1 flex-col overflow-hidden">
      {/* Show editor when editing */}
      <Show when={selectedEntry()}>
        {(entry) => (
          <div class="flex-1 overflow-y-auto p-6">
            {/* Header */}
            <div class="mb-6 flex items-start justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-xl font-bold">{entry().title || "无标题"}</h2>
                  <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    {entryTypeLabel(entry().entry_type)}
                  </span>
                </div>
                <div class="mt-1 text-xs text-zinc-500">
                  创建: {new Date(entry().created).toLocaleString("zh-CN")}
                  {" · "}
                  修改: {new Date(entry().modified).toLocaleString("zh-CN")}
                </div>
              </div>
              <div class="flex gap-2">
                <button
                  onClick={() => setEditingEntry(entry())}
                  class="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
                >
                  ✏️ 编辑
                </button>
                <button
                  onClick={async () => {
                    if (confirm("确定删除此条目？")) {
                      await deleteEntry(entry().id);
                    }
                  }}
                  class="rounded-lg bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                >
                  🗑️ 删除
                </button>
              </div>
            </div>

            {/* Fields */}
            <div class="space-y-4">
              <Show when={entry().username}>
                <FieldRow label="用户名" value={entry().username} onCopy={() => copyToClipboard(entry().username, "username")} copied={copied() === "username"} />
              </Show>

              <Show when={entry().password}>
                <FieldRow
                  label="密码"
                  value={showPassword() ? entry().password : "••••••••••"}
                  onCopy={() => copyToClipboard(entry().password, "password")}
                  copied={copied() === "password"}
                  onToggleVisibility={() => setShowPassword(!showPassword())}
                />
              </Show>

              <Show when={entry().url}>
                <FieldRow label="网址" value={entry().url} onCopy={() => copyToClipboard(entry().url, "url")} copied={copied() === "url"} />
              </Show>

              <Show when={entry().notes}>
                <div>
                  <label class="mb-1 block text-xs font-medium text-zinc-400">备注</label>
                  <div class="whitespace-pre-wrap rounded-lg bg-zinc-800 p-3 text-sm text-zinc-300">
                    {entry().notes}
                  </div>
                </div>
              </Show>

              <Show when={entry().tags.length > 0}>
                <div>
                  <label class="mb-1 block text-xs font-medium text-zinc-400">标签</label>
                  <div class="flex flex-wrap gap-1">
                    {entry().tags.map((tag: string) => (
                      <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>

      {/* Empty state */}
      <Show when={!selectedEntry()}>
        <div class="flex flex-1 items-center justify-center">
          <div class="text-center">
            <div class="text-6xl">🔐</div>
            <h3 class="mt-4 text-lg font-medium text-zinc-400">选择一个条目查看详情</h3>
            <p class="mt-1 text-sm text-zinc-600">从左侧列表选择，或创建新条目</p>
          </div>
        </div>
      </Show>
    </div>
  );
}

function FieldRow(props: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  onToggleVisibility?: () => void;
}) {
  return (
    <div>
      <label class="mb-1 block text-xs font-medium text-zinc-400">{props.label}</label>
      <div class="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2">
        <span class="min-w-0 flex-1 truncate text-sm font-mono">{props.value}</span>
        <Show when={props.onToggleVisibility}>
          <button
            onClick={props.onToggleVisibility}
            class="text-zinc-500 transition-colors hover:text-zinc-300"
          >
            👁️
          </button>
        </Show>
        <button
          onClick={props.onCopy}
          class="text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {props.copied ? "✅" : "📋"}
        </button>
      </div>
    </div>
  );
}
