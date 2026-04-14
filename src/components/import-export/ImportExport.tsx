import { For, Show, createSignal } from "solid-js";
import { ArrowLeftRight, X, CheckCircle, Download, Upload, AlertTriangle } from "lucide-solid";
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
  const [importData, setImportData] = createSignal("");
  const [status, setStatus] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  async function handleImport() {
    const data = importData().trim();
    if (!data) {
      setStatus("请粘贴导入数据");
      return;
    }
    setBusy(true);
    setStatus("导入中...");
    try {
      const count = await vaultImport(importFormat(), data);
      await saveVault();
      await refreshEntries();
      await refreshTrash();
      setStatus(`成功导入 ${count} 条条目`);
      setImportData("");
    } catch (err) {
      setStatus(`导入失败: ${err}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setStatus("导出中...");
    try {
      const result = await vaultExport(exportFormat());
      const ext = exportFormat() === "csv" ? "csv" : "json";
      const mime = exportFormat() === "csv" ? "text/csv" : "application/json";
      const blob = new Blob([result], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pwd-vault-export-${new Date().toISOString().slice(0, 10)}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus(`已导出为 ${ext.toUpperCase()} 文件`);
    } catch (err) {
      setStatus(`导出失败: ${err}`);
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
    // Auto-detect format
    try {
      const fmt = await detectImportFormat(text, file.name);
      setImportFormat(fmt);
    } catch {
      // Keep current format
    }
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

          <div class="p-4">
            {/* Mode toggle */}
            <div class="mb-4 flex rounded-lg bg-zinc-800 p-1">
              <button
                class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  mode() === "import" ? "bg-emerald-600 text-white" : "text-zinc-400"
                }`}
                onClick={() => setMode("import")}
              >
                <Download size={14} /> 导入
              </button>
              <button
                class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  mode() === "export" ? "bg-emerald-600 text-white" : "text-zinc-400"
                }`}
                onClick={() => setMode("export")}
              >
                <Upload size={14} /> 导出
              </button>
            </div>

            <Show when={mode() === "import"}>
              <div class="space-y-3">
                {/* Format selector */}
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">格式</label>
                  <div class="grid grid-cols-3 gap-1.5">
                    <For each={IMPORT_FORMATS}>
                      {(fmt) => (
                        <button
                          class={`rounded-lg px-2 py-1.5 text-xs ${
                            importFormat() === fmt.key
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-800 text-zinc-400"
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

                {/* File upload */}
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">上传文件</label>
                  <input
                    type="file"
                    accept=".json,.csv,.xml,.txt"
                    onChange={handleFileUpload}
                    class="w-full text-sm text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:text-zinc-300"
                  />
                </div>

                {/* Paste area */}
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">或粘贴数据</label>
                  <textarea
                    value={importData()}
                    onInput={(e) => setImportData(e.currentTarget.value)}
                    rows={5}
                    class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
                    placeholder="粘贴 JSON / CSV / XML 数据..."
                  />
                </div>
              </div>
            </Show>

            <Show when={mode() === "export"}>
              <div class="space-y-3">
                <div class="flex items-center gap-1.5 rounded-lg bg-yellow-500/10 p-3 text-xs text-yellow-400">
                  <AlertTriangle size={14} /> 导出为明文数据，请妥善保管。导出后建议立即删除明文文件。
                </div>
                <div>
                  <label class="mb-1 block text-xs text-zinc-400">导出格式</label>
                  <div class="flex gap-2">
                    <For each={EXPORT_FORMATS}>
                      {(fmt) => (
                        <button
                          class={`flex-1 rounded-lg px-3 py-2 text-xs ${
                            exportFormat() === fmt.key
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-800 text-zinc-400"
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
              <div class="mt-3 rounded-lg bg-zinc-800 p-2 text-xs text-zinc-300">
                {status()}
              </div>
            </Show>
          </div>

          {/* Actions */}
          <div class="border-t border-zinc-800 p-3">
            <Show when={mode() === "import"}>
              <button
                onClick={handleImport}
                disabled={busy() || !importData().trim()}
                class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {busy() ? "导入中..." : "开始导入"}
              </button>
            </Show>
            <Show when={mode() === "export"}>
              <button
                onClick={handleExport}
                disabled={busy()}
                class="w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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
