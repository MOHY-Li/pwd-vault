import { For, Show, createSignal, onCleanup } from "solid-js";
import {
  Inbox,
  Star,
  KeyRound,
  FileText,
  CreditCard,
  UserRound,
  Search,
  Plus,
  Lock,
  Trash2,
  History,
  ArrowLeftRight,
  Wrench,
  Loader2,
} from "lucide-solid";
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
  setShowTrash,
  setShowAuditLog,
  setShowImportExport,
  lockVault,
  isUnlocked,
} from "../../stores/vault";
import type { Entry } from "../../api";

const FILTER_ITEMS = [
  { key: "all", label: "全部", Icon: Inbox },
  { key: "favorites", label: "收藏", Icon: Star },
  { key: "login", label: "登录", Icon: KeyRound },
  { key: "note", label: "笔记", Icon: FileText },
  { key: "card", label: "卡包", Icon: CreditCard },
  { key: "identity", label: "身份", Icon: UserRound },
];

function getEntryIcon(entryType: string) {
  const item = FILTER_ITEMS.find(i => i.key === entryType);
  return item ? item.Icon : Inbox;
}

export default function Sidebar() {
  // L4: Debounced search input (200ms)
  const [inputValue, setInputValue] = createSignal(searchQuery());
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSearchInput(value: string) {
    setInputValue(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      setSearchQuery(value);
    }, 200);
  }

  // Clean up debounce timer on unmount
  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  const filteredEntries = () => {
    const q = searchQuery().toLowerCase();
    const filter = sidebarFilter();

    return entries.filter((e: Entry) => {
      if (filter === "favorites" && !e.favorite) return false;
      if (filter !== "all" && filter !== "favorites" && e.entry_type !== filter) return false;
      if (q) {
        const hay = `${e.title} ${e.username} ${e.url} ${e.tags.join(" ")}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    });
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

  // M3: Distinguish loading, empty-vault, and no-search-results states
  const isLoading = () => !isUnlocked();
  const hasNoEntries = () => entries.length === 0;
  const hasNoResults = () => filteredEntries().length === 0 && searchQuery().length > 0;

  return (
    <div class="flex h-full w-64 flex-col border-r border-zinc-800 bg-zinc-900">
      {/* Search — compact */}
      <div class="border-b border-zinc-800 px-3 py-2">
        <div class="relative">
          <Search size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={inputValue()}
            onInput={(e) => handleSearchInput(e.currentTarget.value)}
            placeholder="搜索..."
            class="w-full rounded-md border border-zinc-700 bg-zinc-800 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Filters — 2 rows x 3 */}
      <div class="border-b border-zinc-800 px-2 py-1.5 grid grid-cols-3 gap-1">
        <For each={FILTER_ITEMS}>
          {(item) => (
            <button
              class={`flex items-center justify-center gap-1 rounded-md px-1 py-1.5 text-[11px] font-medium transition-colors ${
                sidebarFilter() === item.key
                  ? "bg-emerald-600/20 text-emerald-400"
                  : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
              }`}
              onClick={() => setSidebarFilter(item.key)}
            >
              <item.Icon size={12} />
              {item.label}
            </button>
          )}
        </For>
      </div>

      {/* Entry list — compact single-line items */}
      <div class="flex-1 overflow-y-auto px-1.5 py-1">
        {/* M3: Loading state */}
        <Show when={isLoading()}>
          <div class="flex flex-col items-center justify-center py-12 text-zinc-600">
            <Loader2 size={24} class="animate-spin" />
            <span class="mt-2 text-xs">加载中...</span>
          </div>
        </Show>

        {/* M3: Empty vault state */}
        <Show when={!isLoading() && hasNoEntries()}>
          <div class="py-12 text-center text-xs text-zinc-600">
            <Inbox size={24} class="mx-auto mb-2 text-zinc-700" />
            暂无条目，点击上方 + 新建
          </div>
        </Show>

        {/* M3: No search results state */}
        <Show when={!isLoading() && !hasNoEntries() && hasNoResults()}>
          <div class="py-8 text-center text-xs text-zinc-600">
            <Search size={20} class="mx-auto mb-2 text-zinc-700" />
            未找到匹配「{searchQuery()}」的条目
          </div>
        </Show>

        {/* Normal entry list */}
        <Show when={!isLoading() && !hasNoEntries() && !hasNoResults()}>
          <For each={filteredEntries()}>
            {(entry) => (
              <button
                class={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                  selectedEntryId() === entry.id
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-300 hover:bg-zinc-800/50"
                }`}
                onClick={() => setSelectedEntryId(entry.id)}
              >
                <span class="text-emerald-500 flex-shrink-0">{(() => { const Ic = getEntryIcon(entry.entry_type); return <Ic size={14} />; })()}</span>
                <span class="truncate text-xs font-medium">{entry.title || "无标题"}</span>
                <Show when={entry.favorite}>
                  <Star size={11} class="text-yellow-400 fill-yellow-400 flex-shrink-0" />
                </Show>
              </button>
            )}
          </For>
        </Show>
      </div>

      {/* Bottom actions — compact */}
      <div class="border-t border-zinc-800 p-2 space-y-1.5">
        <button
          onClick={handleNewEntry}
          class="flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Plus size={14} /> 新建条目
        </button>
        <div class="grid grid-cols-3 gap-1">
          <button
            onClick={() => setShowGenerator(true)}
            class="flex items-center justify-center gap-1 rounded-md bg-zinc-800 px-1 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Wrench size={10} /> 生成
          </button>
          <button
            onClick={() => setShowImportExport(true)}
            class="flex items-center justify-center gap-1 rounded-md bg-zinc-800 px-1 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <ArrowLeftRight size={10} /> 数据
          </button>
          <button
            onClick={() => setShowTrash(true)}
            class="flex items-center justify-center gap-1 rounded-md bg-zinc-800 px-1 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Trash2 size={10} /> 回收
          </button>
        </div>
        <div class="grid grid-cols-2 gap-1">
          <button
            onClick={() => setShowAuditLog(true)}
            class="flex items-center justify-center gap-1 rounded-md bg-zinc-800 px-1 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <History size={10} /> 日志
          </button>
          <button
            onClick={() => lockVault()}
            class="flex items-center justify-center gap-1 rounded-md bg-zinc-800 px-1 py-1 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
          >
            <Lock size={10} /> 锁定
          </button>
        </div>
      </div>
    </div>
  );
}
