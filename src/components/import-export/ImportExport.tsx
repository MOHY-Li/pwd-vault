import { For, Show, createSignal } from "solid-js";
import { ArrowLeftRight, X, Download, Upload, AlertTriangle, CheckCircle, FileText, KeyRound } from "lucide-solid";
import { vaultImport, vaultExport, vaultExportFile, vaultImportFile } from "../../api";
import { saveVault, refreshEntries, refreshTrash, showImportExport, setShowImportExport } from "../../stores/vault";

const IMPORT_FORMATS = [
  { key: "vault", label: ".vault", desc: "pwd-vault 加密备份" },
  { key: "json", label: ".json", desc: "pwd-vault JSON 格式" },
];

const EXPORT_FORMATS = [
  { key: "vault", label: ".vault", desc: "加密格式，完整备份" },
  { key: "json", label: ".json", desc: "完整字段，可迁移到其他工具" },
];

export default function ImportExport() {
  const [mode, setMode] = createSignal<"import" | "export">("import");
  const [importFormat, setImportFormat] = createSignal("vault");
  const [exportFormat, setExportFormat] = createSignal("vault");
  const [importData, setImportData] = createSignal("");
  const [status, setStatus] = createSignal<{ type: "info" | "success" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [importPassword, setImportPassword] = createSignal("");
  const [passwordError, setPasswordError] = createSignal("");
  const [fileName, setFileName] = createSignal("");

  let fileInputRef: HTMLInputElement;

  function showStatus(type: "info" | "success" | "error", msg: string) {
    setStatus({ type, msg });
  }

  async function processFile(file: File) {
    setFileName(file.name);
    if (file.name.endsWith(".vault")) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      setImportData(base64);
      setImportFormat("vault");
      return;
    }
    const text = await file.text();
    setImportData(text);
    try {
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      const count = Array.isArray(arr) ? arr.length : 1;
      setFileName(`${file.name} (${count} 条)`);
    } catch {
      // ignore parse errors
    }
  }

  async function handleImport() {
    const data = importData().trim();
    if (!data) {
      showStatus("error", "请先上传文件或粘贴数据");
      return;
    }
    if (importFormat() === "vault" && !importPassword()) {
      showStatus("error", "导入 .vault 文件需要输入源密码");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      let count: number;
      let resultStr: string;
      if (importFormat() === "vault") {
        resultStr = await vaultImportFile(importPassword(), data);
      } else {
        resultStr = await vaultImport(importFormat(), data);
      }
      // Parse "imported:skipped:renamed"
      const [imported, skipped, renamed] = resultStr.split(":").map(Number);
      const parts: string[] = [];
      const total = imported + renamed;
      if (total > 0) parts.push(`导入 ${total} 条`);
      if (renamed > 0) parts.push(`重命名 ${renamed} 条`);
      if (skipped > 0) parts.push(`跳过 ${skipped} 条重复`);
      await saveVault();
      await refreshEntries();
      await refreshTrash();
      showStatus("success", parts.length > 0 ? parts.join("，") : "没有新条目需要导入");
      setImportData("");
      setImportPassword("");
      setFileName("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (importFormat() === "vault" && /密码|password|decrypt|解密/i.test(msg)) {
        setPasswordError("源保险库密码错误");
      } else {
        showStatus("error", `导入失败: ${msg}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    showStatus("info", "导出中...");
    try {
      let blob: Blob;
      let ext: string;
      if (exportFormat() === "vault") {
        const base64 = await vaultExportFile();
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: "application/octet-stream" });
        ext = "vault";
      } else {
        const result = await vaultExport(exportFormat(), false);
        ext = "json";
        blob = new Blob([result], { type: "application/json" });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pwd-vault-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      showStatus("success", `已导出为 ${ext.toUpperCase()} 文件`);
    } catch (err) {
      showStatus("error", `导出失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await processFile(file);
    // Reset input so the same file can be re-selected
    input.value = "";
  }

  return (
    <Show when={showImportExport()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div class="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-zinc-800 p-4">
            <h3 class="flex items-center gap-2 text-lg font-bold"><ArrowLeftRight size={20} /> 导入导出</h3>
            <button
              onClick={() => setShowImportExport(false)}
              class="text-zinc-500 hover:text-zinc-300"
            >
              <X size={18} />
            </button>
          </div>

          <div class="p-4 space-y-4">
            {/* Mode toggle */}
            <div class="flex rounded-lg bg-zinc-800 p-1">
              <button
                class={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode() === "import" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => { setMode("import"); setStatus(null); }}
              >
                <Download size={14} /> 导入
              </button>
              <button
                class={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  mode() === "export" ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
                onClick={() => { setMode("export"); setStatus(null); }}
              >
                <Upload size={14} /> 导出
              </button>
            </div>

            <Show when={mode() === "import"}>
              <div class="space-y-3">
                {/* Format selector */}
                <div>
                  <label class="mb-1.5 block text-xs text-zinc-400">导入格式</label>
                  <div class="flex gap-2">
                    <For each={IMPORT_FORMATS}>
                      {(fmt) => (
                        <button
                          class={`flex-1 rounded-lg px-3 py-2 text-xs transition-colors ${
                            importFormat() === fmt.key
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                          onClick={() => setImportFormat(fmt.key)}
                        >
                          {fmt.label}
                          <div class="text-[10px] opacity-70">{fmt.desc}</div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Password field for .vault import */}
                <Show when={importFormat() === "vault"}>
                  <div>
                    <label class="mb-1.5 block text-xs text-zinc-400">源保险库密码</label>
                    <div class="relative">
                      <KeyRound size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input
                        type="password"
                        value={importPassword()}
                        onInput={(e) => { setImportPassword(e.currentTarget.value); setPasswordError(""); }}
                        placeholder="输入源 .vault 文件的解锁密码"
                        class="w-full rounded-lg border border-zinc-700 bg-zinc-800 py-2 pl-9 pr-3 text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none placeholder:text-zinc-600"
                      />
                    </div>
                    <Show when={passwordError()}>
                      <p class="mt-1 text-xs text-red-400">{passwordError()}</p>
                    </Show>
                  </div>
                </Show>

                {/* Paste area for .json only + File upload */}
                <div class="flex gap-3">
                  <Show when={importFormat() === "json"}>
                    <div class="flex-1">
                      <textarea
                        value={importData()}
                        onInput={(e) => { setImportData((e.target as HTMLTextAreaElement).value); setStatus(null); }}
                        rows={4}
                        class="w-full h-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none placeholder:text-zinc-600 resize-none"
                        placeholder='粘贴 JSON 数据...'
                      />
                    </div>
                  </Show>

                  <div
                    class={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-800/50 text-xs text-zinc-400 cursor-pointer hover:border-emerald-500/50 hover:bg-zinc-800 transition-colors ${importFormat() === "json" ? "w-40 shrink-0" : "flex-1 p-6"}`}
                    onClick={() => fileInputRef.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).classList.add("border-emerald-500/50", "bg-zinc-800");
                    }}
                    onDragLeave={(e) => {
                      (e.currentTarget as HTMLElement).classList.remove("border-emerald-500/50");
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).classList.remove("border-emerald-500/50");
                      const file = e.dataTransfer?.files?.[0];
                      if (!file) return;
                      processFile(file);
                    }}
                  >
                    <Show when={fileName()} fallback={
                      <>
                        <FileText size={24} class="mb-1.5 text-zinc-500" />
                        <span>{importFormat() === "json" ? "选择文件" : "点击选择文件 或 拖拽到此处"}</span>
                        <span class="mt-0.5 text-[10px] text-zinc-600">支持 .json .vault</span>
                      </>
                    }>
                      <div class="flex items-center gap-2 text-emerald-400">
                        <FileText size={20} />
                        <span class="font-medium">{fileName()}</span>
                      </div>
                      <span class="mt-1 text-[10px] text-zinc-500">点击重新选择</span>
                    </Show>
                  </div>
                  <input
                    ref={fileInputRef!}
                    type="file"
                    accept=".json,.vault"
                    onChange={handleFileUpload}
                    class="hidden"
                  />
                </div>
              </div>
            </Show>

            <Show when={mode() === "export"}>
              <div class="space-y-3">
                <Show when={exportFormat() === "vault"}>
                  <div class="flex items-start gap-2 rounded-lg bg-emerald-500/10 p-3 text-xs text-emerald-400">
                    <AlertTriangle size={14} class="mt-0.5 shrink-0" />
                    <span>导出的 .vault 文件已加密，请妥善保管。导出后建议立即删除明文文件。</span>
                  </div>
                </Show>
                <Show when={exportFormat() !== "vault"}>
                  <div class="flex items-start gap-2 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-400">
                    <AlertTriangle size={14} class="mt-0.5 shrink-0" />
                    <span>导出为明文数据，请妥善保管。导出后建议立即删除明文文件。</span>
                  </div>
                </Show>
                <div>
                  <label class="mb-1.5 block text-xs text-zinc-400">导出格式</label>
                  <div class="flex gap-2">
                    <For each={EXPORT_FORMATS}>
                      {(fmt) => (
                        <button
                          class={`flex-1 rounded-lg px-3 py-2 text-xs transition-colors ${
                            exportFormat() === fmt.key
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                          onClick={() => setExportFormat(fmt.key)}
                        >
                          {fmt.label}
                          <div class="text-[10px] opacity-70">{fmt.desc}</div>
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>

            {/* Status */}
            <Show when={status()}>
              {(s) => (
                <div class={`flex items-center gap-2 rounded-lg p-2.5 text-xs ${
                  s().type === "success" ? "bg-emerald-500/10 text-emerald-400" :
                  s().type === "error" ? "bg-red-500/10 text-red-400" :
                  "bg-zinc-800 text-zinc-400"
                }`}>
                  <Show when={s().type === "success"}><CheckCircle size={14} /></Show>
                  <Show when={s().type === "error"}><AlertTriangle size={14} /></Show>
                  {s().msg}
                </div>
              )}
            </Show>
          </div>

          {/* Actions */}
          <div class="border-t border-zinc-800 p-3">
            <Show when={mode() === "import"}>
              <button
                onClick={handleImport}
                disabled={busy() || !importData().trim()}
                class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {busy() ? "导入中..." : "开始导入"}
              </button>
            </Show>
            <Show when={mode() === "export"}>
              <button
                onClick={handleExport}
                disabled={busy()}
                class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
              >
                {busy() ? "导出中..." : "开始导出"}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
