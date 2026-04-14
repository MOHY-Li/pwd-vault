import { Show, For, Switch, Match, createSignal, createEffect, JSX } from "solid-js";
import {
  KeyRound, FileText, CreditCard, UserRound, X, ChevronDown, ChevronRight, Check, Sparkles,
  Star, Tag, Wrench, PlusCircle, AlertTriangle, Eye, EyeOff,
} from "lucide-solid";
import { editingEntry, setEditingEntry, editingIsNew, addEntry, updateEntry, entries } from "../../stores/vault";
import { generatePassword, evaluateStrength, totpParseUri } from "../../api";
import type { Entry, StrengthReport, CustomField } from "../../api";

const ENTRY_TYPES = [
  { key: "login", label: "登录", Icon: KeyRound },
  { key: "note", label: "笔记", Icon: FileText },
  { key: "card", label: "卡包", Icon: CreditCard },
  { key: "identity", label: "身份", Icon: UserRound },
];

/** M6: Smart card number formatting supporting Amex and standard cards */
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  if (digits.length === 0) return "";

  // Amex: starts with 34 or 37, 15 digits → XXXX XXXXXX XXXXX
  if ((digits.startsWith("34") || digits.startsWith("37")) && digits.length <= 15) {
    if (digits.length <= 4) return digits;
    if (digits.length <= 10) return digits.slice(0, 4) + " " + digits.slice(4);
    return digits.slice(0, 4) + " " + digits.slice(4, 10) + " " + digits.slice(10);
  }

  // Standard 16+ digits → XXXX XXXX XXXX XXXX (or longer for 17-19)
  // Group by 4
  const groups: string[] = [];
  for (let i = 0; i < digits.length; i += 4) {
    groups.push(digits.slice(i, i + 4));
  }
  return groups.join(" ");
}

export default function EntryEditor() {
  const [form, setForm] = createSignal<Entry | null>(null);
  const [strength, setStrength] = createSignal<StrengthReport | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [addingField, setAddingField] = createSignal(false);
  // M7: Unsaved changes tracking
  const [showCancelConfirm, setShowCancelConfirm] = createSignal(false);
  // M1: Save error tracking
  const [saveError, setSaveError] = createSignal("");
  // M3: Local TOTP URI input signal
  const [totpInput, setTotpInput] = createSignal("");
  // F1: Password visibility toggle
  const [showPassword, setShowPassword] = createSignal(false);
  // F2: TOTP secret visibility toggle
  const [showTotpSecret, setShowTotpSecret] = createSignal(false);
  // F7: Debounce timer for strength evaluation
  let strengthTimer: ReturnType<typeof setTimeout> | null = null;

  // Generator options
  const [genLength, setGenLength] = createSignal(20);
  const [genUppercase, setGenUppercase] = createSignal(true);
  const [genLowercase, setGenLowercase] = createSignal(true);
  const [genDigits, setGenDigits] = createSignal(true);
  const [genSpecial, setGenSpecial] = createSignal(true);
  const [genNoAmbiguous, setGenNoAmbiguous] = createSignal(false);
  const [genExpanded, setGenExpanded] = createSignal(false);

  const initForm = () => form() ?? editingEntry();
  const entry = () => initForm();

  function updateField(field: keyof Entry, value: string | boolean | string[] | CustomField[] | null) {
    const e = entry();
    if (!e) return;
    setForm({ ...e, [field]: value });
  }

  // M7: Check if form has been modified from original entry
  function isDirty(): boolean {
    const src = editingEntry();
    const f = form();
    if (!src || !f) return false;
    return JSON.stringify(src) !== JSON.stringify(f);
  }

  /** M7: Handle cancel/close with unsaved changes warning */
  function handleCancel() {
    if (isDirty()) {
      setShowCancelConfirm(true);
    } else {
      setEditingEntry(null);
      setForm(null);
    }
  }

  function confirmCancel() {
    setShowCancelConfirm(false);
    setEditingEntry(null);
    setForm(null);
  }

  async function handleGeneratePassword() {
    const pwd = await generatePassword({
      style: "random",
      length: genLength(),
      uppercase: genUppercase(),
      lowercase: genLowercase(),
      digits: genDigits(),
      special: genSpecial(),
      excludeAmbiguous: genNoAmbiguous(),
    });
    updateField("password", pwd);
    try {
      const report = await evaluateStrength(pwd);
      setStrength(report);
    } catch {
      setStrength({ score: 100, entropy: 128, crack_time: "centuries", level: "强" });
    }
  }

  async function handleSave() {
    let e = form();
    if (!e || !e.title.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      // Clone to avoid corrupting form state on save failure
      e = { ...e };
      // Password history: save old password if changed
      if (!editingIsNew()) {
        const original = editingEntry();
        if (original && original.password && original.password !== e.password) {
          e.password_history = [
            ...(original.password_history ?? []),
            { password: original.password, changed_at: original.modified || original.created }
          ];
        }
      }
      e.modified = new Date().toISOString();
      if (editingIsNew()) {
        await addEntry(e);
      } else {
        await updateEntry(e);
      }
      setEditingEntry(null);
      setForm(null);
      setShowCancelConfirm(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  createEffect(() => {
    const src = editingEntry();
    if (src) {
      setForm({ ...src });
      setShowCancelConfirm(false);
      setSaveError("");
      setTotpInput("");
      setShowPassword(false);
      setShowTotpSecret(false);
      if (src.password) {
        evaluateStrength(src.password)
          .then(r => setStrength(r))
          .catch(() => setStrength(null));
      } else {
        setStrength(null);
      }
    }
  });

  return (
    <Show when={editingEntry()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h3 class="text-sm font-bold text-zinc-200">{editingIsNew() ? "新建条目" : "编辑条目"}</h3>
            <button onClick={handleCancel} class="text-zinc-500 hover:text-zinc-300">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Type selector */}
            <div class="flex justify-center gap-2">
              <For each={ENTRY_TYPES}>
                {(t) => (
                  <button
                    class={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                      entry()?.entry_type === t.key
                        ? "bg-emerald-600 text-white"
                        : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                    }`}
                    onClick={() => updateField("entry_type", t.key)}
                  >
                    <t.Icon size={13} />
                    {t.label}
                  </button>
                )}
              </For>
            </div>

            {/* Title + Favorite */}
            <div>
              <div class="mb-1 flex items-center justify-between">
                <FieldLabel text="标题" required />
                <button
                  type="button"
                  onClick={() => updateField("favorite", !entry()?.favorite)}
                  class={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                    entry()?.favorite
                      ? "text-yellow-400"
                      : "text-zinc-600 hover:text-zinc-400"
                  }`}
                  title="收藏"
                >
                  <Star size={13} class={entry()?.favorite ? "fill-yellow-400" : ""} />
                </button>
              </div>
              <input
                type="text"
                value={entry()?.title ?? ""}
                onInput={(e) => updateField("title", e.currentTarget.value)}
                class="input-field"
                placeholder="输入标题..."
              />
            </div>

            {/* Tags with existing tag chips */}
            <div>
              <FieldLabel text="标签" />
              <input
                type="text"
                value={entry()?.tags?.join(", ") ?? ""}
                onInput={(e) => updateField("tags", e.currentTarget.value.split(",").map((t) => t.trim()).filter(Boolean))}
                class="input-field"
                placeholder="输入新标签，逗号分隔"
              />
              <div class="flex flex-wrap gap-1 mt-1.5">
                {(() => {
                  const allTags = [...new Set(entries.flatMap((e: Entry) => e.tags))].sort();
                  const currentTags = entry()?.tags ?? [];
                  return <For each={allTags}>{(tag: string) => (
                    <button
                      type="button"
                      onClick={() => {
                        const tags = entry()?.tags ?? [];
                        const next = currentTags.includes(tag)
                          ? tags.filter((t: string) => t !== tag)
                          : [...tags, tag];
                        updateField("tags", next);
                      }}
                      class={`rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                        currentTags.includes(tag)
                          ? "bg-emerald-600/30 text-emerald-400"
                          : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {tag}
                    </button>
                  )}</For>;
                })()}
              </div>
            </div>

            {/* Type-specific fields */}
            <Switch>
              {/* ===== LOGIN ===== */}
              <Match when={entry()?.entry_type === "login"}>
                <SectionHeader icon={<KeyRound size={13} />} title="账户信息" />
                <div>
                  <FieldLabel text="用户名" />
                  <input type="text" value={entry()?.username ?? ""} onInput={(e) => updateField("username", e.currentTarget.value)} class="input-field" placeholder="user@example.com" />
                </div>
                <div>
                  <FieldLabel text="密码" />
                  <div class="flex gap-1.5">
                    <input
                      type={showPassword() ? "text" : "password"}
                      value={entry()?.password ?? ""}
                      onInput={(e) => {
                          const val = e.currentTarget.value;
                          updateField("password", val);
                          if (strengthTimer) clearTimeout(strengthTimer);
                          if (val) {
                            strengthTimer = setTimeout(async () => {
                              try { const r = await evaluateStrength(val); setStrength(r); } catch { setStrength(null); }
                            }, 300);
                          } else {
                            setStrength(null);
                          }
                        }}
                      class="input-field flex-1 !font-mono"
                      placeholder="密码"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword())}
                      class="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-zinc-400 hover:text-zinc-200"
                      aria-label={showPassword() ? "隐藏密码" : "显示密码"}
                    >
                      {showPassword() ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button onClick={handleGeneratePassword} class="flex items-center justify-center rounded-lg bg-emerald-600 px-2.5 text-white hover:bg-emerald-500" aria-label="生成密码">
                      <Sparkles size={14} />
                    </button>
                  </div>
                  <Show when={strength()}>
                    {(s) => (
                      <div class="mt-1 flex items-center gap-2">
                        <div class="h-1 flex-1 rounded-full bg-zinc-800">
                          <div class="h-full rounded-full transition-all" style={{ width: `${s().score}%`, "background-color": s().score >= 80 ? "#10b981" : s().score >= 50 ? "#f59e0b" : "#ef4444" }} />
                        </div>
                        <span class="text-[10px] text-zinc-500">{s().level}</span>
                      </div>
                    )}
                  </Show>
                  <button onClick={() => setGenExpanded(!genExpanded())} class="mt-1 flex items-center gap-1 text-[10px] text-zinc-600 hover:text-zinc-400">
                    {genExpanded() ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    生成选项
                  </button>
                  <Show when={genExpanded()}>
                    <div class="mt-1.5 space-y-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-2.5">
                      <div>
                        <div class="flex items-center justify-between text-[10px] text-zinc-500 mb-0.5">
                          <span>长度</span>
                          <span class="text-emerald-400 font-mono">{genLength()}</span>
                        </div>
                        <input type="range" min={8} max={64} value={genLength()} onInput={(e) => setGenLength(Number(e.currentTarget.value))} class="w-full accent-emerald-500" />
                      </div>
                      <div class="grid grid-cols-2 gap-1">
                        <GenCheckbox label="大写 A-Z" checked={genUppercase()} onChange={setGenUppercase} />
                        <GenCheckbox label="小写 a-z" checked={genLowercase()} onChange={setGenLowercase} />
                        <GenCheckbox label="数字 0-9" checked={genDigits()} onChange={setGenDigits} />
                        <GenCheckbox label="符号 !@#" checked={genSpecial()} onChange={setGenSpecial} />
                        <GenCheckbox label="排除易混淆" checked={genNoAmbiguous()} onChange={setGenNoAmbiguous} />
                      </div>
                    </div>
                  </Show>
                </div>
                <div>
                  <FieldLabel text="网址" />
                  <input type="text" value={entry()?.url ?? ""} onInput={(e) => updateField("url", e.currentTarget.value)} class="input-field" placeholder="https://example.com" />
                </div>
                <div>
                  <FieldLabel text="TOTP URI" />
                  <div class="flex gap-1.5">
                    <input
                      type={showTotpSecret() ? "text" : "password"}
                      value={totpInput()}
                      onInput={async (e) => {
                        const uri = e.currentTarget.value.trim();
                        setTotpInput(e.currentTarget.value);
                        if (uri.startsWith("otpauth://")) {
                          try { const config = await totpParseUri(uri); const ent = entry(); if (ent) setForm({ ...ent, totp: config }); } catch {}
                        }
                      }}
                      class="input-field flex-1 !text-[11px]"
                      placeholder="otpauth://totp/..."
                    />
                    <button
                      type="button"
                      onClick={() => setShowTotpSecret(!showTotpSecret())}
                      class="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 px-2 text-zinc-400 hover:text-zinc-200"
                      aria-label={showTotpSecret() ? "隐藏密钥" : "显示密钥"}
                    >
                      {showTotpSecret() ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Show when={entry()?.totp}>
                    <div class="flex items-center justify-between mt-1">
                      <span class="flex items-center gap-1 text-[10px] text-emerald-400"><Check size={10} /> TOTP 已配置</span>
                      <button type="button" onClick={() => updateField("totp", null)} class="text-[10px] text-zinc-600 hover:text-red-400">清除</button>
                    </div>
                  </Show>
                </div>
              </Match>

              {/* ===== NOTE ===== */}
              <Match when={entry()?.entry_type === "note"}>
                <SectionHeader icon={<FileText size={13} />} title="笔记内容" />
                <textarea
                  value={entry()?.notes ?? ""}
                  onInput={(e) => updateField("notes", e.currentTarget.value)}
                  rows={8}
                  class="input-field min-h-[160px] resize-y"
                  placeholder="在这里写笔记内容..."
                />
              </Match>

              {/* ===== CARD ===== */}
              <Match when={entry()?.entry_type === "card"}>
                <SectionHeader icon={<CreditCard size={13} />} title="卡片信息" />
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel text="持卡人" />
                    <input type="text" value={entry()?.username ?? ""} onInput={(e) => updateField("username", e.currentTarget.value)} class="input-field" placeholder="张三" />
                  </div>
                  <div>
                    <FieldLabel text="有效期" />
                    <input type="text" value={entry()?.url ?? ""} onInput={(e) => {
                      let raw = e.currentTarget.value.replace(/\D/g, "").slice(0, 4);
                      if (raw.length >= 3) raw = raw.slice(0, 2) + "/" + raw.slice(2);
                      updateField("url", raw);
                    }} class="input-field !font-mono" placeholder="MM/YY" />
                  </div>
                </div>
                <div>
                  <FieldLabel text="卡号" />
                  <input type="text" value={entry()?.password ?? ""} onInput={(e) => {
                    // L7: Save cursor position before formatting
                    const el = e.currentTarget;
                    const cursor = el.selectionStart ?? 0;
                    const prevLen = el.value.length;
                    // M6: Use smart card number formatting (Amex support)
                    const formatted = formatCardNumber(el.value);
                    updateField("password", formatted);
                    // L7: Restore cursor position with adjustment for length change
                    const delta = formatted.length - prevLen;
                    const newPos = Math.min(cursor + delta, formatted.length);
                    queueMicrotask(() => { el.selectionStart = el.selectionEnd = newPos; });
                  }} class="input-field !font-mono" placeholder="0000 0000 0000 0000" />
                </div>
              </Match>

              {/* ===== IDENTITY ===== */}
              <Match when={entry()?.entry_type === "identity"}>
                <SectionHeader icon={<UserRound size={13} />} title="身份信息" />
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel text="姓名" />
                    <input type="text" value={entry()?.username ?? ""} onInput={(e) => updateField("username", e.currentTarget.value)} class="input-field" placeholder="张三" />
                  </div>
                  <div>
                    <FieldLabel text="公司" />
                    <input type="text" value={entry()?.url ?? ""} onInput={(e) => updateField("url", e.currentTarget.value)} class="input-field" placeholder="公司名称" />
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel text="邮箱" />
                    <input type="text" value={(() => { const f = entry()?.custom_fields?.find((c: CustomField) => c.name === "邮箱"); return f ? f.value : ""; })()} onInput={(e) => {
                      const fields = [...(entry()?.custom_fields ?? [])];
                      const idx = fields.findIndex((c: CustomField) => c.name === "邮箱");
                      if (idx >= 0) fields[idx] = { ...fields[idx], value: e.currentTarget.value };
                      else fields.push({ name: "邮箱", value: e.currentTarget.value, field_type: "text" });
                      updateField("custom_fields", fields);
                    }} class="input-field" placeholder="user@example.com" />
                  </div>
                  <div>
                    <FieldLabel text="电话" />
                    <input type="text" value={(() => { const f = entry()?.custom_fields?.find((c: CustomField) => c.name === "电话"); return f ? f.value : ""; })()} onInput={(e) => {
                      let raw = e.currentTarget.value.replace(/[^\d\s\-+()]/g, "").slice(0, 15);
                      const fields = [...(entry()?.custom_fields ?? [])];
                      const idx = fields.findIndex((c: CustomField) => c.name === "电话");
                      if (idx >= 0) fields[idx] = { ...fields[idx], value: raw };
                      else fields.push({ name: "电话", value: raw, field_type: "text" });
                      updateField("custom_fields", fields);
                    }} class="input-field !font-mono" placeholder="138 0000 0000" />
                  </div>
                </div>
                {/* Dynamic custom fields (exclude 邮箱/电话) */}
                <For each={entry()?.custom_fields?.filter((c: CustomField) => c.name !== "邮箱" && c.name !== "电话") ?? []}>{(f: CustomField) => {
                  const fieldName = f.name;
                  return (
                    <div class="flex items-end gap-1.5">
                      <div class="flex-1">
                        <FieldLabel text={fieldName} />
                        <input type="text" value={entry()?.custom_fields?.find((c: CustomField) => c.name === fieldName)?.value ?? ""} onInput={(e) => {
                          const fields = [...(entry()?.custom_fields ?? [])];
                          const idx = fields.findIndex((c: CustomField) => c.name === fieldName);
                          if (idx >= 0) { fields[idx] = { ...fields[idx], value: e.currentTarget.value }; updateField("custom_fields", fields); }
                        }} class="input-field" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const fields = (entry()?.custom_fields ?? []).filter((c: CustomField) => c.name !== fieldName);
                          updateField("custom_fields", fields);
                        }}
                        class="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                }}</For>
                <Show when={addingField()}>
                  <div class="flex items-end gap-1.5">
                    <div class="flex-1">
                      <FieldLabel text="字段名称" />
                      <input
                        ref={(el) => setTimeout(() => el.focus(), 50)}
                        type="text"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const name = e.currentTarget.value.trim();
                            if (name) {
                              const fields = [...(entry()?.custom_fields ?? [])];
                              if (!fields.some((c: CustomField) => c.name === name)) {
                                fields.push({ name, value: "", field_type: "text" });
                                updateField("custom_fields", fields);
                              }
                            }
                            setAddingField(false);
                          } else if (e.key === "Escape") {
                            setAddingField(false);
                          }
                        }}
                        class="input-field"
                        placeholder="输入名称后按回车"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setAddingField(false)}
                      class="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </Show>
                <Show when={!addingField()}>
                  <button
                    type="button"
                    onClick={() => setAddingField(true)}
                    class="flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-[11px] text-zinc-500 hover:text-emerald-400 hover:border-emerald-500/40 transition-colors"
                  >
                    <PlusCircle size={13} /> 新增字段
                  </button>
                </Show>
              </Match>
            </Switch>

            {/* Common fields for non-note types */}
            <Show when={entry()?.entry_type !== "note"}>
              <SectionHeader icon={<FileText size={13} />} title="备注" />
              <textarea
                value={entry()?.notes ?? ""}
                onInput={(e) => updateField("notes", e.currentTarget.value)}
                rows={3}
                class="input-field resize-y"
                placeholder="添加备注..."
              />
            </Show>

          </div>

          {/* Footer */}
          <div class="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
            {/* M1: Save error display */}
            <Show when={saveError()}>
              <div class="mr-auto flex-1 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
                {saveError()}
              </div>
            </Show>
            {/* M7: Cancel button triggers unsaved changes check */}
            <button
              onClick={handleCancel}
              class="rounded-lg bg-zinc-800 px-4 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving() || !entry()?.title?.trim()}
              class="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving() ? "保存中..." : "保存"}
            </button>
          </div>

          {/* M7: Unsaved changes confirmation overlay */}
          <Show when={showCancelConfirm()}>
            <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/40 rounded-xl">
              <div class="mx-6 rounded-lg border border-amber-500/30 bg-zinc-900 p-4 shadow-xl">
                <div class="flex items-start gap-2">
                  <AlertTriangle size={16} class="text-amber-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p class="text-sm text-zinc-200 font-medium">未保存的更改</p>
                    <p class="mt-1 text-xs text-zinc-400">你有未保存的更改，确定要放弃吗？</p>
                  </div>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <button
                    onClick={() => setShowCancelConfirm(false)}
                    class="rounded-md bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    继续编辑
                  </button>
                  <button
                    onClick={confirmCancel}
                    class="rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
                  >
                    放弃更改
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>

    </Show>
  );
}

// ---- Helpers ----

function SectionHeader(props: { icon: JSX.Element; title: string }) {
  return (
    <div class="flex items-center gap-1.5 pt-1">
      <span class="text-emerald-500">{props.icon}</span>
      <span class="text-[11px] font-medium text-zinc-400">{props.title}</span>
    </div>
  );
}

function FieldLabel(props: { text: string; required?: boolean }) {
  return (
    <div class="mb-1 flex items-center gap-1">
      <span class="text-[11px] font-medium text-zinc-500">{props.text}</span>
      <Show when={props.required}><span class="text-red-500 text-[10px]">*</span></Show>
    </div>
  );
}

function GenCheckbox(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex items-center gap-1.5 text-[10px] text-zinc-400">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} class="accent-emerald-500" />
      {props.label}
    </label>
  );
}
