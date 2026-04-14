import { createSignal, Show, onMount } from "solid-js";
import { Shield } from "lucide-solid";
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

  onMount(async () => {
    const dir = await appDataDir();
    const vaultPath = dir + "my.vault";
    setDefaultPath(vaultPath);
    const fileExists = await exists(vaultPath);
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
      if (pwd.length < 8) {
        setError("主密码至少需要8个字符");
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
    } catch (err: any) {
      setError(err?.toString() || "操作失败");
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
