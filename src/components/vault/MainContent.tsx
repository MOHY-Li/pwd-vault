import { Show, For, createSignal, createEffect, onCleanup, Switch, Match, JSX } from "solid-js";
import {
  Trash2, Check, Copy, Pencil, Eye, EyeOff, Shield, KeyRound, FileText, CreditCard, UserRound, Star, Calendar, Tag, PlusCircle, AlertTriangle,
} from "lucide-solid";
import type { LucideIcon } from "lucide-solid";
import { entries, selectedEntryId, setEditingEntry, setEditingIsNew, deleteEntry, totpCodes, refreshTotp, copyToClipboard } from "../../stores/vault";
import type { CustomField } from "../../api";

export default function MainContent() {
  const [showPassword, setShowPassword] = createSignal(false);
  const [copied, setCopied] = createSignal("");
  const [pendingDelete, setPendingDelete] = createSignal(false);

  const selectedEntry = () => entries.find((e) => e.id === selectedEntryId());

  // M8: Reset showPassword when switching entries
  createEffect(() => {
    const id = selectedEntryId();
    if (id) {
      setShowPassword(false);
      setPendingDelete(false);
    }
  });

  // L2: Timer ref to prevent copied race condition
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function handleCopy(text: string, field: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      if (copiedTimer) clearTimeout(copiedTimer);
      setCopied(field);
      copiedTimer = setTimeout(() => setCopied(""), 2000);
    }
  }

  return (
    <div class="flex flex-1 flex-col overflow-hidden">
      <Show when={selectedEntry()}>
        {(entry) => (
          <div class="flex-1 overflow-y-auto">
            {/* Header card */}
            <div class="border-b border-zinc-800 bg-zinc-900/80 px-5 py-4">
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-3">
                  <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800">
                    <EntryTypeIcon type={entry().entry_type} size={22} />
                  </div>
                  <div>
                    <div class="flex items-center gap-2">
                      <h2 class="text-base font-bold text-zinc-100">{entry().title || "无标题"}</h2>
                      <span class="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                        <EntryTypeLabel type={entry().entry_type} />
                      </span>
                      <Show when={entry().favorite}>
                        <Star size={13} class="text-yellow-400 fill-yellow-400" />
                      </Show>
                    </div>
                    <div class="mt-0.5 flex items-center gap-3 text-[10px] text-zinc-600">
                      <span class="flex items-center gap-1"><Calendar size={10} /> 创建 {new Date(entry().created).toLocaleDateString("zh-CN")}</span>
                      <span class="flex items-center gap-1"><Calendar size={10} /> 修改 {new Date(entry().modified).toLocaleDateString("zh-CN")}</span>
                    </div>
                  </div>
                </div>
                <div class="flex gap-1.5">
                  <button
                    onClick={() => { setEditingIsNew(false); setEditingEntry(entry()); }}
                    class="flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                  >
                    <Pencil size={12} /> 编辑
                  </button>
                  <button
                    onClick={() => setPendingDelete(true)}
                    class="flex items-center gap-1 rounded-md bg-red-500/10 px-2.5 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 size={12} /> 删除
                  </button>
                </div>
              </div>
              {/* Inline delete confirmation */}
              <Show when={pendingDelete()}>
                <div class="mt-3 flex items-center justify-between rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
                  <span class="text-xs text-red-400"><AlertTriangle size={13} class="inline mr-1" /> 确定删除？</span>
                  <div class="flex gap-2">
                    <button
                      onClick={async () => { await deleteEntry(entry().id); setPendingDelete(false); }}
                      class="rounded-md bg-red-600 px-2.5 py-1 text-xs text-white hover:bg-red-500"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => setPendingDelete(false)}
                      class="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-400 hover:bg-zinc-700"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </Show>
              {/* Tags */}
              <Show when={entry().tags?.length > 0}>
                <div class="mt-3 flex items-center gap-1.5">
                  <Tag size={11} class="text-zinc-600" />
                  <For each={entry().tags}>{(tag: string) => (
                    <span class="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">{tag}</span>
                  )}</For>
                </div>
              </Show>
            </div>

            {/* Type-specific content */}
            <div class="p-5">
              <Switch>
                {/* ===== LOGIN ===== */}
                <Match when={entry().entry_type === "login"}>
                  <div class="space-y-4">
                    <SectionTitle icon={<KeyRound size={13} />} title="账户信息" />
                    <div class="grid grid-cols-2 gap-3">
                      <FieldCard label="用户名" value={entry().username} placeholder="未设置" onCopy={() => handleCopy(entry().username, "username")} copied={copied() === "username"} />
                      <FieldCard
                        label="密码"
                        value={showPassword() ? entry().password : (entry().password ? "••••••••••••" : "")}
                        placeholder="未设置"
                        onCopy={() => handleCopy(entry().password, "password")}
                        copied={copied() === "password"}
                        onToggleVisibility={() => setShowPassword(!showPassword())}
                        visible={showPassword()}
                      />
                    </div>
                    <FieldCard label="网址" value={entry().url} placeholder="未设置" onCopy={() => handleCopy(entry().url, "url")} copied={copied() === "url"} />
                    <Show when={entry().totp}>
                      <TotpDisplay entryId={entry().id} copied={copied() === "totp"} onCopy={(code) => handleCopy(code, "totp")} />
                    </Show>
                    <SectionTitle icon={<FileText size={13} />} title="备注" />
                    <div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                      <div class="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed">
                        {entry().notes || "无备注内容"}
                      </div>
                    </div>
                  </div>
                </Match>

                {/* ===== NOTE ===== */}
                <Match when={entry().entry_type === "note"}>
                  <div class="space-y-4">
                    <SectionTitle icon={<FileText size={13} />} title="笔记内容" />
                    <div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-4 min-h-[200px]">
                      <div class="whitespace-pre-wrap text-sm text-zinc-300 leading-relaxed">
                        {entry().notes || "无内容"}
                      </div>
                    </div>
                    <Show when={entry().custom_fields?.length > 0}>
                      <SectionTitle icon={<PlusCircle size={13} />} title="附加字段" />
                      <div class="grid grid-cols-2 gap-3">
                        <For each={entry().custom_fields}>{(f: CustomField, i: () => number) => (
                          <FieldCard label={f.name || `字段 ${i() + 1}`} value={f.value} placeholder="--" onCopy={() => handleCopy(f.value, `custom_${i()}`)} copied={copied() === `custom_${i()}`} />
                        )}</For>
                      </div>
                    </Show>
                  </div>
                </Match>

                {/* ===== CARD ===== */}
                <Match when={entry().entry_type === "card"}>
                  <div class="space-y-4">
                    <SectionTitle icon={<CreditCard size={13} />} title="卡片信息" />
                    <div class="grid grid-cols-2 gap-3">
                      <FieldCard label="持卡人" value={entry().username} placeholder="未设置" onCopy={() => handleCopy(entry().username, "username")} copied={copied() === "username"} />
                      <FieldCard label="有效期" value={entry().url} placeholder="MM/YY" onCopy={() => handleCopy(entry().url, "url")} copied={copied() === "url"} />
                    </div>
                    <FieldCard
                      label="卡号"
                      value={showPassword() ? entry().password : (entry().password ? "•••• •••• •••• ••••" : "")}
                      placeholder="未设置"
                      onCopy={() => handleCopy(entry().password, "password")}
                      copied={copied() === "password"}
                      onToggleVisibility={() => setShowPassword(!showPassword())}
                      visible={showPassword()}
                    />
                    <SectionTitle icon={<FileText size={13} />} title="备注" />
                    <div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                      <div class="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed">
                        {entry().notes || "无备注内容"}
                      </div>
                    </div>
                    <Show when={entry().custom_fields?.length > 0}>
                      <SectionTitle icon={<PlusCircle size={13} />} title="附加字段" />
                      <div class="grid grid-cols-2 gap-3">
                        <For each={entry().custom_fields}>{(f: CustomField, i: () => number) => (
                          <FieldCard label={f.name || `字段 ${i() + 1}`} value={f.value} placeholder="--" onCopy={() => handleCopy(f.value, `custom_${i()}`)} copied={copied() === `custom_${i()}`} />
                        )}</For>
                      </div>
                    </Show>
                  </div>
                </Match>

                {/* ===== IDENTITY ===== */}
                <Match when={entry().entry_type === "identity"}>
                  <div class="space-y-4">
                    <SectionTitle icon={<UserRound size={13} />} title="身份信息" />
                    <div class="grid grid-cols-2 gap-3">
                      <FieldCard label="姓名" value={entry().username} placeholder="未设置" onCopy={() => handleCopy(entry().username, "username")} copied={copied() === "username"} />
                      <FieldCard label="公司" value={entry().url} placeholder="未设置" onCopy={() => handleCopy(entry().url, "url")} copied={copied() === "url"} />
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                      <FieldCard
                        label="邮箱"
                        value={(() => { const f = entry().custom_fields?.find((c: CustomField) => c.name === "邮箱"); return f ? f.value : ""; })()}
                        placeholder="未设置"
                        onCopy={() => { const f = entry().custom_fields?.find((c: CustomField) => c.name === "邮箱"); if (f) handleCopy(f.value, "email"); }}
                        copied={copied() === "email"}
                      />
                      <FieldCard
                        label="电话"
                        value={(() => { const f = entry().custom_fields?.find((c: CustomField) => c.name === "电话"); return f ? f.value : ""; })()}
                        placeholder="未设置"
                        onCopy={() => { const f = entry().custom_fields?.find((c: CustomField) => c.name === "电话"); if (f) handleCopy(f.value, "phone"); }}
                        copied={copied() === "phone"}
                      />
                    </div>
                    <SectionTitle icon={<FileText size={13} />} title="备注" />
                    <div class="rounded-lg border border-zinc-800 bg-zinc-800/40 p-3">
                      <div class="whitespace-pre-wrap text-xs text-zinc-400 leading-relaxed">
                        {entry().notes || "无备注内容"}
                      </div>
                    </div>
                    <Show when={entry().custom_fields?.length > 0}>
                      <SectionTitle icon={<PlusCircle size={13} />} title="自定义字段" />
                      <div class="grid grid-cols-2 gap-3">
                        <For each={entry().custom_fields}>{(f: CustomField, i: () => number) => (
                          <FieldCard label={f.name || `字段 ${i() + 1}`} value={f.value} placeholder="--" onCopy={() => handleCopy(f.value, `custom_${i()}`)} copied={copied() === `custom_${i()}`} />
                        )}</For>
                      </div>
                    </Show>
                    <Show when={!entry().custom_fields?.length}>
                      <div class="rounded-lg border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-600">
                        暂无自定义字段，编辑条目可添加电话、地址等信息
                      </div>
                    </Show>
                  </div>
                </Match>
              </Switch>
            </div>
          </div>
        )}
      </Show>

      {/* Empty state */}
      <Show when={!selectedEntry()}>
        <div class="flex flex-1 items-center justify-center">
          <div class="text-center text-zinc-600">
            <Shield size={40} class="mx-auto text-zinc-700" />
            <h3 class="mt-3 text-sm font-medium text-zinc-500">选择一个条目查看详情</h3>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ---- Sub-components ----

function SectionTitle(props: { icon: JSX.Element; title: string }) {
  return (
    <div class="mb-2 flex items-center gap-1.5">
      <span class="text-emerald-500">{props.icon}</span>
      <span class="text-xs font-medium text-zinc-400">{props.title}</span>
    </div>
  );
}

function EntryTypeIcon(props: { type: string; size: number }) {
  const map: Record<string, LucideIcon> = { login: KeyRound, note: FileText, card: CreditCard, identity: UserRound };
  const Ic = map[props.type] || KeyRound;
  return <Ic size={props.size} class="text-emerald-500" />;
}

function EntryTypeLabel(props: { type: string }) {
  const map: Record<string, string> = { login: "登录", note: "笔记", card: "卡包", identity: "身份" };
  return <>{map[props.type] || props.type}</>;
}

function FieldCard(props: {
  label: string;
  value: string;
  placeholder: string;
  onCopy: () => void;
  copied: boolean;
  onToggleVisibility?: () => void;
  visible?: boolean;
}) {
  const hasValue = () => !!props.value;
  return (
    <div class="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[11px] font-medium text-zinc-500">{props.label}</span>
        <div class="flex gap-1">
          <Show when={props.onToggleVisibility}>
            <button onClick={props.onToggleVisibility} class="text-zinc-600 hover:text-zinc-300 transition-colors">
              {props.visible ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </Show>
          <Show when={hasValue()}>
            <button onClick={props.onCopy} class="text-zinc-600 hover:text-zinc-300 transition-colors">
              {props.copied ? <Check size={12} class="text-emerald-400" /> : <Copy size={12} />}
            </button>
          </Show>
        </div>
      </div>
      <div class={`text-xs font-mono leading-relaxed ${hasValue() ? "text-zinc-300" : "text-zinc-600 italic"}`}>
        {hasValue() ? props.value : props.placeholder}
      </div>
    </div>
  );
}

function TotpDisplay(props: { entryId: string; copied: boolean; onCopy: (code: string) => void }) {
  const [code, setCode] = createSignal("");
  const [remaining, setRemaining] = createSignal(0);

  createEffect(() => {
    refreshTotp(props.entryId);
    const interval = setInterval(() => refreshTotp(props.entryId), 5000);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    const data = totpCodes()[props.entryId];
    if (data) { setCode(data.code); setRemaining(data.remaining); }
  });

  return (
    <div>
      <SectionTitle icon={<Shield size={13} />} title="两步验证 (TOTP)" />
      <div class="rounded-lg border border-zinc-800 bg-zinc-800/30 p-3">
        <div class="flex items-center justify-between">
          <span class="font-mono text-xl tracking-[0.3em] text-emerald-400">{code() || "------"}</span>
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-zinc-600">{remaining()}s</span>
            <button onClick={() => code() && props.onCopy(code())} class="text-zinc-600 hover:text-zinc-300 transition-colors">
              {props.copied ? <Check size={13} class="text-emerald-400" /> : <Copy size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
