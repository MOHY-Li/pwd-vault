import { For, Show, createSignal } from "solid-js";
import { ArrowLeftRight, X, Download, Upload, AlertTriangle, CheckCircle, FileText, Clipboard } from "lucide-solid";
import { vaultImport, vaultExport, detectImportFormat } from "../../api";
import { saveVault, refreshEntries, refreshTrash, showImportExport, setShowImportExport } from "../../stores/vault";

const IMPORT_FORMATS = [
  { key: "json", label: "JSON", desc: "通用 JSON 格式" },
  { key: "csv", label: "CSV", desc: "逗号分隔值" },
  { key: "bitwarden_json", label: "Bitwarden JSON", desc: "Bitwarden 导出" },
  { key: "bitwarden_csv", label: "Bitwarden CSV", desc: "Bitwarden CSV 导出" },
  { key: "onepassword_csv", label: "1Password CSV", desc: "1Password 导出" },
  { key: "keepass_xml", label: "KeePass XML", desc: "KeePass XML 导出" },
];

const EXPORT_FORMATS = [
  { key: "json", label: "JSON", desc: "完整字段，通用格式" },
  { key: "csv", label: "CSV", desc: "基础字段，兼容其他工具" },
];

export default function ImportExport() {
  const [mode, setMode] = createSignal<"import" | "export">("import");
  const [importFormat, setImportFormat] = createSignal("json");
  const [exportFormat, setExportFormat] = createSignal("json");
  const [excludePasswords, setExcludePasswords] = createSignal(true);
  const [importData, setImportData] = createSignal("");
  const [inputMethod, setInputMethod] = createSignal<"paste" | "file">("paste");
  const [status, setStatus] = createSignal<{ type: "info" | "success" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [previewCount, setPreviewCount] = createSignal<number | null>(null);

  function showStatus(type: "info" | "success" | "error", msg: string) {
    setStatus({ type, msg });
  }

  async function handleImport() {
    const data = importData().trim();
    if (!data) {
      showStatus("error", "请先上传文件或粘贴数据");
      return;
    }
    setBusy(true);
    showStatus("info", "导入中...");
    try {
      const count = await vaultImport(importFormat(), data);
      await saveVault();
      await refreshEntries();
      await refreshTrash();
      showStatus("success", `成功导入 ${count} 条条目`);
      setImportData("");
      setPreviewCount(null);
    } catch (err) {
      showStatus("error", `导入失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    showStatus("info", "导出中...");
    try {
      const result = await vaultExport(exportFormat(), excludePasswords());
      const ext = exportFormat() === "csv" ? "csv" : "json";
      const mime = exportFormat() === "csv" ? "text/csv" : "application/json";
      const blob = new Blob([result], { type: mime });
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
    const text = await file.text();
    setImportData(text);
    // Auto-detect format and estimate count
    try {
      const fmt = await detectImportFormat(text, file.name);
      setImportFormat(fmt);
      // Estimate preview count
      try {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
        const count = Array.isArray(arr) ? arr.length : 1;
        setPreviewCount(count);
        showStatus("info", `已检测格式: ${fmt}，共 ${count} 条待导入`);
      } catch {
        setPreviewCount(null);
        showStatus("info", `已检测格式: ${fmt}`);
      }
    } catch {
      setPreviewCount(null);
    }
  }

  function handlePasteInput(e: Event) {
    const val = (e.target as HTMLTextAreaElement).value;
    setImportData(val);
    // Estimate preview count based on format
    if (!val.trim()) {
      setPreviewCount(null);
      return;
    }
    try {
      const fmt = importFormat();
      if (fmt === "json" || fmt === "bitwarden_json") {
        const parsed = JSON.parse(val);
        const arr = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
        setPreviewCount(Array.isArray(arr) ? arr.length : 1);
      } else {
        // Rough line count for CSV/XML
        const lines = val.trim().split("\n").length;
        setPreviewCount(Math.max(0, lines - 1)); // subtract header
      }
    } catch {
      setPreviewCount(null);
    }
    setStatus(null);
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
                  <label class="mb-1.5 block text-xs text-zinc-400">格式</label>
                  <div class="grid grid-cols-3 gap-1.5">
                    <For each={IMPORT_FORMATS}>
                      {(fmt) => (
                        <button
                          class={`rounded-lg px-2 py-1.5 text-xs transition-colors ${
                            importFormat() === fmt.key
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                          onClick={() => setImportFormat(fmt.key)}
                          title={fmt.desc}
                        >
                          {fmt.label}
                        </button>
                      )}
                    </For>
                  </div>
                </div>

                {/* Input method toggle */}
                <div>
                  <label class="mb-1.5 block text-xs text-zinc-400">数据来源</label>
                  <div class="flex rounded-lg bg-zinc-800 p-1">
                    <button
                      class={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        inputMethod() === "paste" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                      }`}
                      onClick={() => { setInputMethod("paste"); setStatus(null); }}
                    >
                      <Clipboard size={13} /> 粘贴
                    </button>
                    <button
                      class={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        inputMethod() === "file" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                      }`}
                      onClick={() => { setInputMethod("file"); setStatus(null); }}
                    >
                      <FileText size={13} /> 上传文件
                    </button>
                  </div>
                </div>

                {/* Paste area */}
                <Show when={inputMethod() === "paste"}>
                  <div>
                    <textarea
                      value={importData()}
                      onInput={handlePasteInput}
                      rows={6}
                      class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none placeholder:text-zinc-600"
                      placeholder="粘贴 JSON / CSV / XML 数据..."
                    />
                    <Show when={previewCount() !== null}>
                      <p class="mt-1.5 text-xs text-zinc-500">
                        检测到约 <span class="text-emerald-400 font-medium">{previewCount()}</span> 条待导入条目
                      </p>
                    </Show>
                  </div>
                </Show>

                {/* File upload */}
                <Show when={inputMethod() === "file"}>
                  <div>
                    <label class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-700 bg-zinc-800/50 p-6 text-xs text-zinc-400 cursor-pointer hover:border-emerald-500/50 hover:bg-zinc-800 transition-colors">
                      <FileText size={24} class="mb-2 text-zinc-500" />
                      <span>点击选择文件 或 拖拽到此处</span>
                      <span class="mt-1 text-[10px] text-zinc-600">支持 .json .csv .xml .txt</span>
                      <input
                        type="file"
                        accept=".json,.csv,.xml,.txt"
                        onChange={handleFileUpload}
                        class="hidden"
                      />
                    </label>
                  </div>
                </Show>
              </div>
            </Show>

            <Show when={mode() === "export"}>
              <div class="space-y-3">
                <div class="flex items-start gap-2 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-400">
                  <AlertTriangle size={14} class="mt-0.5 shrink-0" />
                  <span>导出为明文数据，请妥善保管。导出后建议立即删除明文文件。</span>
                </div>
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
                <label class="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludePasswords()}
                    onChange={(e) => setExcludePasswords(e.currentTarget.checked)}
                    class="accent-emerald-500"
                  />
                  <div>
                    <div class="font-medium">排除敏感数据</div>
                    <div class="text-[10px] text-zinc-500">导出时不包含密码、TOTP 密钥和密码历史</div>
                  </div>
                </label>
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
                {busy() ? "导出中..." : "导出文件"}
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
