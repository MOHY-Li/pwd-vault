import { Show, Switch, Match, createSignal, createEffect } from "solid-js";
import {
  KeyRound, FileText, CreditCard, UserRound, X, ChevronDown, ChevronRight, Check, Sparkles,
  Star, Tag, Wrench, Link, User, Shield, Calendar, PlusCircle,
} from "lucide-solid";
import { editingEntry, setEditingEntry, editingIsNew, addEntry, updateEntry, entries } from "../../stores/vault";
import { generatePassword, evaluateStrength, totpParseUri } from "../../api";
import type { Entry, StrengthReport } from "../../api";

const ENTRY_TYPES = [
  { key: "login", label: "登录", Icon: KeyRound },
  { key: "note", label: "笔记", Icon: FileText },
  { key: "card", label: "卡包", Icon: CreditCard },
  { key: "identity", label: "身份", Icon: UserRound },
];

export default function EntryEditor() {
  const [form, setForm] = createSignal<Entry | null>(null);
  const [strength, setStrength] = createSignal<StrengthReport | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [addingField, setAddingField] = createSignal(false);

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

  function updateField(field: keyof Entry, value: any) {
    const e = entry();
    if (!e) return;
    setForm({ ...e, [field]: value });
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

  createEffect(() => {
    const src = editingEntry();
    if (src) {
      setForm({ ...src });
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
            <button onClick={() => { setEditingEntry(null); setForm(null); }} class="text-zinc-500 hover:text-zinc-300">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Type selector */}
            <div class="flex justify-center gap-2">
              {ENTRY_TYPES.map((t) => (
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
              ))}
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
                  return allTags.map(tag => (
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
                  ));
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
                      type="text"
                      value={entry()?.password ?? ""}
                      onInput={async (e) => {
                          const val = e.currentTarget.value;
                          updateField("password", val);
                          if (val) {
                            try { const r = await evaluateStrength(val); setStrength(r); } catch { setStrength(null); }
                          } else {
                            setStrength(null);
                          }
                        }}
                      class="input-field flex-1 !font-mono"
                      placeholder="密码"
                    />
                    <button onClick={handleGeneratePassword} class="flex items-center justify-center rounded-lg bg-emerald-600 px-2.5 text-white hover:bg-emerald-500">
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
                  <input
                    type="text"
                    value={entry()?.totp?.secret ? "otpauth://totp/..." : ""}
                    onInput={async (e) => {
                      const uri = e.currentTarget.value.trim();
                      if (uri.startsWith("otpauth://")) {
                        try { const config = await totpParseUri(uri); const ent = entry(); if (ent) setForm({ ...ent, totp: config }); } catch {}
                      }
                    }}
                    class="input-field !text-[11px]"
                    placeholder="otpauth://totp/..."
                  />
                  <Show when={entry()?.totp}>
                    <span class="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-400"><Check size={10} /> 已配置</span>
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
                    let raw = e.currentTarget.value.replace(/\D/g, "").slice(0, 19);
                    if (raw.length > 4) raw = raw.slice(0, 4) + " " + raw.slice(4);
                    if (raw.length > 9) raw = raw.slice(0, 9) + " " + raw.slice(9);
                    if (raw.length > 14) raw = raw.slice(0, 14) + " " + raw.slice(14);
                    if (raw.length > 19) raw = raw.slice(0, 19) + " " + raw.slice(19);
                    updateField("password", raw);
                  }} class="input-field !font-mono" placeholder="0000 0000 0000 0000 000" />
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
                    <input type="text" value={(() => { const f = entry()?.custom_fields?.find((c: any) => c.name === "邮箱"); return f ? f.value : ""; })()} onInput={(e) => {
                      const fields = [...(entry()?.custom_fields ?? [])];
                      const idx = fields.findIndex((c: any) => c.name === "邮箱");
                      if (idx >= 0) fields[idx] = { ...fields[idx], value: e.currentTarget.value };
                      else fields.push({ name: "邮箱", value: e.currentTarget.value, field_type: "text" });
                      updateField("custom_fields", fields);
                    }} class="input-field" placeholder="user@example.com" />
                  </div>
                  <div>
                    <FieldLabel text="电话" />
                    <input type="text" value={(() => { const f = entry()?.custom_fields?.find((c: any) => c.name === "电话"); return f ? f.value : ""; })()} onInput={(e) => {
                      const fields = [...(entry()?.custom_fields ?? [])];
                      const idx = fields.findIndex((c: any) => c.name === "电话");
                      if (idx >= 0) fields[idx] = { ...fields[idx], value: e.currentTarget.value };
                      else fields.push({ name: "电话", value: e.currentTarget.value, field_type: "text" });
                      updateField("custom_fields", fields);
                    }} class="input-field" placeholder="138 0000 0000" />
                  </div>
                </div>
                {/* Dynamic custom fields (exclude 邮箱/电话) */}
                {(() => {
                  const extraFields = entry()?.custom_fields?.filter((c: any) => c.name !== "邮箱" && c.name !== "电话") ?? [];
                  return extraFields.map((f: any, i: number) => (
                    <div class="flex items-end gap-1.5">
                      <div class="flex-1">
                        <FieldLabel text={f.name} />
                        <input type="text" value={f.value} onInput={(e) => {
                          const fields = [...(entry()?.custom_fields ?? [])];
                          const idx = fields.findIndex((c: any) => c.name === f.name);
                          if (idx >= 0) { fields[idx] = { ...fields[idx], value: e.currentTarget.value }; updateField("custom_fields", fields); }
                        }} class="input-field" />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const fields = (entry()?.custom_fields ?? []).filter((c: any) => c.name !== f.name);
                          updateField("custom_fields", fields);
                        }}
                        class="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ));
                })()}
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
                              if (!fields.some((c: any) => c.name === name)) {
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
            <button
              onClick={() => { setEditingEntry(null); setForm(null); }}
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
        </div>
      </div>

      {/* Global input styles */}
      <style>{`
        .input-field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid #3f3f46;
          background: #27272a;
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
          color: #f4f4f5;
          outline: none;
          transition: border-color 0.15s;
        }
        .input-field:focus { border-color: #10b981; }
        .input-field::placeholder { color: #52525b; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
        ::-webkit-scrollbar-thumb:hover { background: #52525b; }
      `}</style>
    </Show>
  );
}

// ---- Helpers ----

function SectionHeader(props: { icon: any; title: string }) {
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
