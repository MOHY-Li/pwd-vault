import { createSignal, Show, onMount, For } from "solid-js";
import { Wrench, X, Check, Copy, RefreshCw } from "lucide-solid";
import { generatePassword, evaluateStrength } from "../../api";
import type { StrengthReport } from "../../api";
import { showGenerator, setShowGenerator, copyToClipboard } from "../../stores/vault";

export default function PasswordGen() {
  const [style, setStyle] = createSignal<"random" | "diceware">("random");
  const [length, setLength] = createSignal(20);
  const [uppercase, setUppercase] = createSignal(true);
  const [lowercase, setLowercase] = createSignal(true);
  const [digits, setDigits] = createSignal(true);
  const [special, setSpecial] = createSignal(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = createSignal(false);
  const [wordCount, setWordCount] = createSignal(5);
  const [separator, setSeparator] = createSignal("-");
  const [result, setResult] = createSignal("");
  const [strength, setStrength] = createSignal<StrengthReport | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal("");

  async function handleGenerate() {
    try {
      const pwd = await generatePassword({
        style: style(),
        length: length(),
        uppercase: uppercase(),
        lowercase: lowercase(),
        digits: digits(),
        special: special(),
        excludeAmbiguous: excludeAmbiguous(),
        wordCount: wordCount(),
        separator: separator(),
      });
      setResult(pwd);
      setError("");
      const report = await evaluateStrength(pwd);
      setStrength(report);
    } catch (err) {
      setResult("");
      setStrength(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopy() {
    const ok = await copyToClipboard(result());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  // Generate on mount
  onMount(() => { handleGenerate(); });

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-lg font-bold"><Wrench size={20} /> 密码生成器</h3>
          <button
            onClick={() => setShowGenerator(false)}
            class="text-zinc-500 hover:text-zinc-300"
          >
            <X size={18} />
          </button>
        </div>

        {/* Style toggle */}
        <div class="mb-4 flex rounded-lg bg-zinc-800 p-1">
          <button
            class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${style() === "random" ? "bg-emerald-600 text-white" : "text-zinc-400"}`}
            onClick={() => setStyle("random")}
          >
            随机字符
          </button>
          <button
            class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${style() === "diceware" ? "bg-emerald-600 text-white" : "text-zinc-400"}`}
            onClick={() => setStyle("diceware")}
          >
            Diceware 单词
          </button>
        </div>

        <Show when={style() === "random"}>
          <div class="space-y-3">
            <div>
              <label class="mb-1 flex items-center justify-between text-xs text-zinc-400">
                <span>长度</span>
                <span>{length()}</span>
              </label>
              <input
                type="range"
                min={8}
                max={128}
                value={length()}
                onInput={(e) => setLength(Number(e.currentTarget.value))}
                class="w-full accent-emerald-500"
              />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <Checkbox label="大写字母 (A-Z)" checked={uppercase} onChange={setUppercase} />
              <Checkbox label="小写字母 (a-z)" checked={lowercase} onChange={setLowercase} />
              <Checkbox label="数字 (0-9)" checked={digits} onChange={setDigits} />
              <Checkbox label="特殊符号 (!@#)" checked={special} onChange={setSpecial} />
              <Checkbox label="排除易混淆字符" checked={excludeAmbiguous} onChange={setExcludeAmbiguous} />
            </div>
          </div>
        </Show>

        <Show when={style() === "diceware"}>
          <div class="space-y-3">
            <div>
              <label class="mb-1 flex items-center justify-between text-xs text-zinc-400">
                <span>单词数</span>
                <span>{wordCount()}</span>
              </label>
              <input
                type="range"
                min={4}
                max={10}
                value={wordCount()}
                onInput={(e) => setWordCount(Number(e.currentTarget.value))}
                class="w-full accent-emerald-500"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-zinc-400">分隔符</label>
              <div class="flex gap-2">
                <For each={["-", " ", ".", "_"]}>
                  {(sep) => (
                    <button
                      class={`rounded-lg px-3 py-1 text-xs ${separator() === sep ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-400"}`}
                      onClick={() => setSeparator(sep)}
                    >
                      {sep === " " ? "空格" : sep}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        {/* Result */}
        <Show when={error()}>
          <div class="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error()}
          </div>
        </Show>

        <Show when={result()}>
          <div class="mt-4">
            <div class="flex items-center gap-2 rounded-lg bg-zinc-800 p-3">
              <code class="min-w-0 flex-1 break-all text-sm text-emerald-400">{result()}</code>
              <button onClick={handleCopy} class="text-zinc-400 hover:text-zinc-200">
                {copied() ? <><Check size={14} class="inline" /> 已复制</> : <><Copy size={14} class="inline" /> 复制</>}
              </button>
            </div>
            <Show when={strength()}>
              {(s) => (
                <div class="mt-2 flex items-center gap-2 text-xs">
                  <div class="h-1.5 flex-1 rounded-full bg-zinc-800">
                    <div
                      class="h-full rounded-full"
                      style={{
                        width: `${s().score}%`,
                        "background-color": s().score >= 80 ? "#10b981" : s().score >= 50 ? "#f59e0b" : "#ef4444",
                      }}
                    />
                  </div>
                  <span class="text-zinc-500">{s().level} · {s().crack_time}</span>
                </div>
              )}
            </Show>
          </div>
        </Show>

        <button
          onClick={handleGenerate}
          class="mt-4 w-full rounded-lg bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          <RefreshCw size={14} class="inline" /> 重新生成
        </button>
      </div>
    </div>
  );
}

function Checkbox(props: { label: string; checked: () => boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-300">
      <input
        type="checkbox"
        checked={props.checked()}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        class="accent-emerald-500"
      />
      {props.label}
    </label>
  );
}
