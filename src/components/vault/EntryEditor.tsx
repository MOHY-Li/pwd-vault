import { Show, createSignal } from "solid-js";
import { editingEntry, setEditingEntry, editingIsNew, addEntry, updateEntry } from "../../stores/vault";
import { generatePassword, evaluateStrength, totpParseUri } from "../../api";
import type { Entry, StrengthReport } from "../../api";

export default function EntryEditor() {
  const [form, setForm] = createSignal<Entry | null>(null);
  const [strength, setStrength] = createSignal<StrengthReport | null>(null);
  const [saving, setSaving] = createSignal(false);

  // Initialize form from editingEntry
  const initForm = () => form() ?? editingEntry();
  const entry = () => initForm();

  function updateField(field: keyof Entry, value: any) {
    const e = entry();
    if (!e) return;
    setForm({ ...e, [field]: value });
  }

  async function handleGeneratePassword() {
    const pwd = await generatePassword({ style: "random", length: 20 });
    updateField("password", pwd);
    const report = await evaluateStrength(pwd);
    setStrength(report);
  }

  async function handleSave() {
    const e = form();
    if (!e || !e.title.trim()) return;

    setSaving(true);
    try {
      e.modified = new Date().toISOString();
      if (editingIsNew()) {
        await addEntry(e);
      } else {
        await updateEntry(e);
      }
      setEditingEntry(null);
      setForm(null);
    } finally {
      setSaving(false);
    }
  }

  // Monitor editingEntry changes
  const src = editingEntry();
  if (src && !form()) {
    setForm({ ...src });
  }

  return (
    <Show when={editingEntry()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-lg font-bold">{editingEntry()?.title ? "编辑条目" : "新建条目"}</h3>
            <button
              onClick={() => { setEditingEntry(null); setForm(null); }}
              class="text-zinc-500 hover:text-zinc-300"
            >
              ✕
            </button>
          </div>

          <div class="space-y-4">
            {/* Type selector */}
            <div>
              <label class="mb-1 block text-xs text-zinc-400">类型</label>
              <div class="flex gap-2">
                {(["login", "note", "card", "identity"] as const).map((t) => (
                  <button
                    class={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      entry()?.entry_type === t
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                    onClick={() => updateField("entry_type", t)}
                  >
                    {{ login: "🔑 登录", note: "📝 笔记", card: "💳 支付卡", identity: "🪪 身份" }[t]}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <label class="mb-1 block text-xs text-zinc-400">标题 *</label>
              <input
                type="text"
                value={entry()?.title ?? ""}
                onInput={(e) => updateField("title", e.currentTarget.value)}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="GitHub"
              />
            </div>

            {/* Login fields */}
            <Show when={entry()?.entry_type === "login"}>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">用户名</label>
                  <input
                    type="text"
                    value={entry()?.username ?? ""}
                    onInput={(e) => updateField("username", e.currentTarget.value)}
                    class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="user@example.com"
                  />
                </div>
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">网址</label>
                  <input
                    type="text"
                    value={entry()?.url ?? ""}
                    onInput={(e) => updateField("url", e.currentTarget.value)}
                    class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="https://github.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label class="mb-1 block text-xs text-zinc-400">密码</label>
                <div class="flex gap-2">
                  <input
                    type="text"
                    value={entry()?.password ?? ""}
                    onInput={(e) => updateField("password", e.currentTarget.value)}
                    class="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="点击生成或手动输入"
                  />
                  <button
                    onClick={handleGeneratePassword}
                    class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                  >
                    生成
                  </button>
                </div>
                <Show when={strength()}>
                  {(s) => (
                    <div class="mt-1 flex items-center gap-2 text-xs">
                      <div class="h-1.5 flex-1 rounded-full bg-zinc-800">
                        <div
                          class="h-full rounded-full transition-all"
                          style={{
                            width: `${s().score * 10}%`,
                            "background-color":
                              s().score >= 80
                                ? "#10b981"
                                : s().score >= 50
                                  ? "#f59e0b"
                                  : "#ef4444",
                          }}
                        />
                      </div>
                      <span class="text-zinc-500">{s().label}</span>
                    </div>
                  )}
                </Show>
              </div>
            </Show>

            {/* Notes */}
            <div>
              <label class="mb-1 block text-xs text-zinc-400">备注</label>
              <textarea
                value={entry()?.notes ?? ""}
                onInput={(e) => updateField("notes", e.currentTarget.value)}
                rows={3}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="添加备注..."
              />
            </div>

            {/* Tags */}
            <div>
              <label class="mb-1 block text-xs text-zinc-400">标签（逗号分隔）</label>
              <input
                type="text"
                value={entry()?.tags?.join(", ") ?? ""}
                onInput={(e) =>
                  updateField(
                    "tags",
                    e.currentTarget.value.split(",").map((t) => t.trim()).filter(Boolean),
                  )
                }
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="work, dev"
              />
            </div>

            {/* Favorite */}
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={entry()?.favorite ?? false}
                onChange={(e) => updateField("favorite", e.currentTarget.checked)}
                class="accent-emerald-500"
              />
              <span class="text-zinc-300">收藏此条目</span>
            </label>

            {/* TOTP URI */}
            <div>
              <label class="mb-1 block text-xs text-zinc-400">TOTP 验证码 URI（可选）</label>
              <input
                type="text"
                value={entry()?.totp?.secret ? `otpauth://totp/...` : ""}
                onInput={async (e) => {
                  const uri = e.currentTarget.value.trim();
                  if (uri.startsWith("otpauth://")) {
                    try {
                      const config = await totpParseUri(uri);
                      const e = entry();
                      if (e) setForm({ ...e, totp: config });
                    } catch {
                      // Invalid URI, ignore
                    }
                  }
                }}
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                placeholder="otpauth://totp/..."
              />
              <Show when={entry()?.totp}>
                <div class="mt-1 text-xs text-emerald-400">✅ TOTP 已配置</div>
              </Show>
            </div>
          </div>

          {/* Actions */}
          <div class="mt-6 flex justify-end gap-2">
            <button
              onClick={() => { setEditingEntry(null); setForm(null); }}
              class="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving() || !entry()?.title?.trim()}
              class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving() ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
