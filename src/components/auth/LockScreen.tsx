import { createSignal, Show, onMount } from "solid-js";
import { Shield, AlertTriangle } from "lucide-solid";
import { createVault, unlockVault } from "../../stores/vault";
import { appDataDir } from "@tauri-apps/api/path";
import { exists } from "@tauri-apps/plugin-fs";

export default function LockScreen() {
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [isSetup, setIsSetup] = createSignal(true);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [defaultPath, setDefaultPath] = createSignal("");
  const [vaultFileExists, setVaultFileExists] = createSignal(false);

  onMount(async () => {
    const dir = await appDataDir();
    // Normalize: appDataDir returns .../com.mohyli.pwdvault on macOS, not .../com.mohyli.pwdvault/
    const normalizedDir = dir.endsWith('/') ? dir.slice(0, -1) : dir;
    const vaultPath = normalizedDir + "/my.vault";
    setDefaultPath(vaultPath);
    const fileExists = await exists(vaultPath);
    setVaultFileExists(fileExists);
    setIsSetup(!fileExists);
  });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");

    const pwd = password();
    if (!pwd) {
      setError("请输入主密码");
      return;
    }

    if (isSetup()) {
      if (pwd !== confirmPassword()) {
        setError("两次密码不一致");
        return;
      }
      if (pwd.length < 7) {
        setError("主密码至少需要7个字符");
        return;
      }
    }

    setLoading(true);
    try {
      if (isSetup()) {
        await createVault(pwd, defaultPath());
      } else {
        await unlockVault(pwd, defaultPath());
      }
      setPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div class="flex flex-1 items-center justify-center">
      <div class="w-full max-w-md p-8">
        {/* Logo */}
        <div class="mb-8 text-center">
          <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600/20">
            <Shield size={36} class="text-emerald-400" />
          </div>
          <h1 class="text-2xl font-bold text-zinc-100">Pwd-Vault</h1>
          <p class="mt-1 text-sm text-zinc-400">安全的本地密码管理器</p>
        </div>

        {/* Tab switcher */}
        <div class="mb-6 flex rounded-lg bg-zinc-800 p-1">
          <button
            class={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              isSetup()
                ? "bg-emerald-600 text-white"
                : vaultFileExists()
                  ? "text-zinc-500 hover:text-zinc-300"
                  : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setIsSetup(true)}
          >
            创建新库
          </button>
          <button
            class={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              !isSetup()
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            onClick={() => setIsSetup(false)}
          >
            解锁已有库
          </button>
        </div>

        {/* Warning when vault exists and user is on create tab */}
        <Show when={vaultFileExists() && isSetup()}>
          <div class="mb-4 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
            <AlertTriangle size={16} class="text-amber-400 mt-0.5 flex-shrink-0" />
            <div class="text-xs text-amber-300">
              检测到已有密码库，创建新库将覆盖现有数据库。
            </div>
          </div>
        </Show>

        {/* Form */}
        <form onSubmit={handleSubmit} class="space-y-4">
          <div>
            <label class="mb-1 block text-sm text-zinc-300">主密码</label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="输入主密码"
              class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              autofocus
            />
          </div>

          <Show when={isSetup()}>
            <div>
              <label class="mb-1 block text-sm text-zinc-300">确认密码</label>
              <input
                type="password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                placeholder="再次输入主密码"
                class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </Show>

          <Show when={error()}>
            <div class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error()}
            </div>
          </Show>

          <button
            type="submit"
            disabled={loading()}
            class="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {loading() ? "处理中..." : isSetup() ? "创建密码库" : "解锁"}
          </button>
        </form>
      </div>
    </div>
  );
}
