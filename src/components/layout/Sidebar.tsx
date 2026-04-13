import { For, Show } from "solid-js";
import {
  entries,
  selectedEntryId,
  setSelectedEntryId,
  searchQuery,
  setSearchQuery,
  sidebarFilter,
  setSidebarFilter,
  setEditingEntry,
  setEditingIsNew,
  setShowGenerator,
  lockVault,
  deleteEntry,
} from "../../stores/vault";
import type { Entry } from "../../api";

const FILTER_ITEMS = [
  { key: "all" as const, label: "全部条目", icon: "📋" },
  { key: "favorites" as const, label: "收藏", icon: "⭐" },
  { key: "login" as const, label: "登录", icon: "🔑" },
  { key: "note" as const, label: "笔记", icon: "📝" },
  { key: "card" as const, label: "支付卡", icon: "💳" },
  { key: "identity" as const, label: "身份", icon: "🪪" },
];

export default function Sidebar() {
  const filteredEntries = () => {
    const q = searchQuery().toLowerCase();
    const filter = sidebarFilter();

    return entries.filter((e: Entry) => {
      // Filter by category
      if (filter === "favorites" && !e.favorite) return false;
      if (filter === "login" && e.entry_type !== "login") return false;
      if (filter === "note" && e.entry_type !== "note") return false;
      if (filter === "card" && e.entry_type !== "card") return false;
      if (filter === "identity" && e.entry_type !== "identity") return false;

      // Filter by search query
      if (q) {
        const hay = `${e.title} ${e.username} ${e.url} ${e.tags.join(" ")}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
  };

  const categoryIcon = (type: string) => {
    switch (type) {
      case "login": return "🔑";
      case "note": return "📝";
      case "card": return "💳";
      case "identity": return "🪪";
      default: return "📋";
    }
  };

  function handleNewEntry() {
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
  }

  return (
    <div class="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Search */}
      <div class="border-b border-zinc-800 p-3">
        <div class="relative">
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">🔍</span>
          <input
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="搜索..."
            class="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-sm text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Filters */}
      <div class="border-b border-zinc-800 p-2">
        <For each={FILTER_ITEMS}>
          {(item) => (
            <button
              class={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                sidebarFilter() === item.key
                  ? "bg-emerald-600/20 text-emerald-400"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => setSidebarFilter(item.key)}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          )}
        </For>
      </div>

      {/* Entry list */}
      <div class="flex-1 overflow-y-auto p-2">
        <For each={filteredEntries()}>
          {(entry) => (
            <button
              class={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                selectedEntryId() === entry.id
                  ? "bg-zinc-800 text-zinc-100"
                  : "text-zinc-300 hover:bg-zinc-800/50"
              }`}
              onClick={() => setSelectedEntryId(entry.id)}
            >
              <span class="text-lg">{categoryIcon(entry.entry_type)}</span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{entry.title || "无标题"}</div>
                <div class="truncate text-xs text-zinc-500">{entry.username || entry.url}</div>
              </div>
              <Show when={entry.favorite}>
                <span class="text-yellow-500">⭐</span>
              </Show>
            </button>
          )}
        </For>
        <Show when={filteredEntries().length === 0}>
          <div class="py-8 text-center text-sm text-zinc-600">暂无条目</div>
        </Show>
      </div>

      {/* Bottom actions */}
      <div class="border-t border-zinc-800 p-3 space-y-2">
        <button
          onClick={handleNewEntry}
          class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <span>＋</span> 新建条目
        </button>
        <div class="flex gap-2">
          <button
            onClick={() => setShowGenerator(true)}
            class="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            🔧 密码生成器
          </button>
          <button
            onClick={() => lockVault()}
            class="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            🔒 锁定
          </button>
        </div>
      </div>
    </div>
  );
}
