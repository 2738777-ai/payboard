/** PayPal Orders v2（沙盒）。金額一律由伺服器給；每個呼叫都帶穩定的 PayPal-Request-Id，重送不會重複建單或重複扣款。 */
export type PayPalEnv = { PAYPAL_CLIENT_ID?: string; PAYPAL_CLIENT_SECRET?: string; PAYPAL_BASE?: string };

let cached: { token: string; until: number; key: string } | null = null;

async function token(env: PayPalEnv, f: typeof fetch) {
  const key = env.PAYPAL_CLIENT_ID ?? "";
  if (cached && cached.key === key && cached.until > Date.now() + 60_000) return cached.token;
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error("PAYPAL_NOT_CONFIGURED");
  const r = await f(`${base(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: "Basic " + btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`), "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PAYPAL_AUTH_${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000, key };
  return j.access_token;
}
const base = (env: PayPalEnv) => env.PAYPAL_BASE ?? "https://api-m.sandbox.paypal.com";
const usd = (cents: number) => (cents / 100).toFixed(2);

async function call(env: PayPalEnv, f: typeof fetch, path: string, init: { method: string; requestId?: string; body?: unknown }) {
  const r = await f(`${base(env)}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${await token(env, f)}`,
      "content-type": "application/json",
      ...(init.requestId ? { "PayPal-Request-Id": init.requestId } : {}),
      prefer: "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(`PAYPAL_${r.status}_${j?.name ?? "ERROR"}`);
  return j;
}

export async function createOrder(env: PayPalEnv, totalCents: number, lockId: string, f: typeof fetch = fetch) {
  const j = await call(env, f, "/v2/checkout/orders", {
    method: "POST",
    requestId: `pb-create-${lockId}`,
    body: { intent: "CAPTURE", purchase_units: [{ reference_id: lockId, description: "PayBoard order (sandbox)", amount: { currency_code: "USD", value: usd(totalCents) } }] },
  });
  return { id: String(j.id), status: String(j.status) };
}

export async function getOrder(env: PayPalEnv, orderId: string, f: typeof fetch = fetch) {
  const j = await call(env, f, `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
  const value = j.purchase_units?.[0]?.amount?.value;
  return { id: String(j.id), status: String(j.status), cents: Math.round(Number(value) * 100) };
}

export async function captureOrder(env: PayPalEnv, orderId: string, lockId: string, f: typeof fetch = fetch) {
  const j = await call(env, f, `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", requestId: `pb-capture-${lockId}`, body: {} });
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: String(j.status), captureId: String(cap?.id ?? ""), cents: Math.round(Number(cap?.amount?.value) * 100), captureStatus: String(cap?.status ?? "") };
}
