/** 站內 AI：讀價目表、目前購物車、預算 → 回「整個新購物車」的提案。AI 永遠只能提案。 */
import { CATALOG, SKUS, cleanCart, totalCents, type Cart, type Sku } from "./law";

export type AiResult = { cart: Cart; note: string; budgetCents: number | null; source: "workers-ai" | "gemini" | "local"; diagnostic?: string };

const ZH_NUM: Record<string, number> = { 一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const ALIASES: Record<Sku, RegExp> = {
  latte: /拿鐵|latte/i,
  americano: /美式|americano/i,
  croissant: /可頌|croissant/i,
  bagel: /貝果|bagel/i,
  water: /礦泉水|水|water/i,
};

/** 沒有金鑰或 AI 失敗時的本機備援（明確標示 source=local） */
export function localParse(text: string, cart: Cart): AiResult {
  const next: Cart = { ...cart };
  let touched = false;
  for (const sku of SKUS) {
    const re = new RegExp(`(\\d+|[一兩二三四五六七八九十])?\\s*(?:杯|個|瓶|份|x|×)?\\s*(?:${ALIASES[sku].source})`, "i");
    const m = text.match(re);
    if (!m) continue;
    const n = m[1] ? (ZH_NUM[m[1]] ?? Number(m[1])) : 1;
    if (/不要|移除|remove|no /i.test(text)) delete next[sku];
    else next[sku] = n;
    touched = true;
  }
  const b = text.match(/(?:預算|budget)\D{0,6}(\d+(?:\.\d+)?)/i);
  const budgetCents = b ? Math.round(Number(b[1]) * 100) : null;
  return {
    cart: cleanCart(next),
    note: touched ? "依你的話調整購物車（本機規則）" : "沒聽懂要買什麼，購物車沒變",
    budgetCents,
    source: "local",
  };
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    items: { type: "ARRAY", items: { type: "OBJECT", properties: { sku: { type: "STRING", enum: SKUS }, qty: { type: "INTEGER" } }, required: ["sku", "qty"] } },
    budget_usd: { type: "NUMBER", nullable: true },
    note: { type: "STRING" },
  },
  required: ["items", "note"],
};

export type AiBinding = {
  run(model: "@cf/google/gemma-4-26b-a4b-it", input: {
    response_format: { type: "json_object" };
    chat_template_kwargs: { enable_thinking: false };
    max_completion_tokens: number;
    temperature: number;
    messages: { role: "user"; content: string }[];
  }): Promise<unknown>;
};

export async function aiPropose(
  text: string,
  cart: Cart,
  budgetCents: number | null,
  env: { AI?: AiBinding; GEMINI_API_KEY?: string; GEMINI_BASE?: string; GEMINI_MODEL?: string },
  fetchFn: typeof fetch = fetch,
): Promise<AiResult> {
  if (!env.AI && !env.GEMINI_API_KEY) return localParse(text, cart);
  const menu = SKUS.map((s) => `${s}: ${CATALOG[s].name}/${CATALOG[s].zh} $${(CATALOG[s].cents / 100).toFixed(2)}`).join("\n");
  const prompt = [
    "You help a shopper edit a cart. Return the FULL new cart (not a diff).",
    "Only use SKUs from the menu. Respect the budget if given; if impossible, get as close as you can under it and say so in note.",
    "You can only PROPOSE. The human approves; payment happens later in PayPal. Never claim anything was paid.",
    "Reply note in the shopper's language, at most 2 sentences.",
    `Menu:\n${menu}`,
    `Current cart: ${JSON.stringify(cart)} (total $${(totalCents(cart) / 100).toFixed(2)})`,
    `Current budget: ${budgetCents == null ? "none" : "$" + (budgetCents / 100).toFixed(2)}`,
    `Shopper said: ${JSON.stringify(text.slice(0, 500))}`,
  ].join("\n");
  const base = env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com";
  const workersModel = "@cf/google/gemma-4-26b-a4b-it";
  const model = env.AI ? workersModel : (env.GEMINI_MODEL ?? "gemini-3.5-flash-lite");
  try {
    let payload: unknown;
    if (env.AI) {
      const result = await env.AI.run(workersModel, {
        response_format: { type: "json_object" },
        // Gemma 4 on Workers AI enables slow extended reasoning by default. Shopping cart JSON needs no chain of thought.
        chat_template_kwargs: { enable_thinking: false },
        max_completion_tokens: 256,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt + "\nReturn compact JSON with items (array of {sku, qty}), budget_usd (number or null), and note (one short sentence)." }],
      }) as { response?: unknown; choices?: { message?: { content?: string } }[] };
      payload = result?.choices?.[0]?.message?.content ?? result?.response;
    } else {
      const r = await fetchFn(`${base}/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
        }),
      });
      if (!r.ok) {
        // Expose only a coarse HTTP/status code: never disclose Google's raw error or credentials.
        const fail = (await r.json().catch(() => null)) as { error?: { status?: unknown } } | null;
        const kind = fail?.error?.status;
        const safeKind = typeof kind === "string" && /^[A-Z_]{3,40}$/.test(kind) ? `_${kind}` : "";
        throw new Error(`HTTP_${r.status}${safeKind}`);
      }
      const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      payload = j.candidates?.[0]?.content?.parts?.[0]?.text;
    }
    if (!payload) throw new Error("EMPTY_RESULT");
    let raw: { items?: { sku: string; qty: number }[]; note?: string; budget_usd?: number | null };
    try { raw = typeof payload === "string" ? JSON.parse(payload) : payload as typeof raw; }
    catch { throw new Error("INVALID_JSON"); }
    if (!Array.isArray(raw?.items) || raw.items.some(it => !it || typeof it.sku !== "string" || !Number.isInteger(it.qty))) throw new Error("INVALID_SCHEMA");
    const next: Record<string, number> = {};
    for (const it of raw.items ?? []) next[it.sku] = it.qty;
    return {
      cart: cleanCart(next), // 價目表沒有的、負數、超量，一律在這裡擋掉
      note: String(raw.note ?? "").slice(0, 280) || "已提出購物車提案",
      budgetCents: typeof raw.budget_usd === "number" && raw.budget_usd > 0 ? Math.round(raw.budget_usd * 100) : budgetCents,
      source: env.AI ? "workers-ai" : "gemini",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    const diagnostic = /^(HTTP_\d{3}(?:_[A-Z_]{3,40})?|EMPTY_RESULT|INVALID_JSON|INVALID_SCHEMA)$/.test(msg) ? msg : "NETWORK_ERROR";
    // No shopper text, model output, credentials or raw upstream response in logs.
    const providerError = err as { code?: unknown; status?: unknown } | null;
    console.warn(env.AI ? "PAYBOARD_WORKERS_AI_FALLBACK" : "PAYBOARD_GEMINI_FALLBACK", {
      model,
      diagnostic,
      ...(env.AI && typeof providerError?.code === "number" ? { code: providerError.code } : {}),
      ...(env.AI && typeof providerError?.status === "number" ? { status: providerError.status } : {}),
    });
    const fb = localParse(text, cart);
    return { ...fb, diagnostic, note: fb.note + "（AI 暫時沒回應，改用本機規則）" };
  }
}
