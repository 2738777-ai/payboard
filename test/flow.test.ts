// 完整閉環（真的跑 Cloudflare 本機執行環境）：假 PayPal、假 Gemini，所有「出包」情境都要擋下。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startMock } from "./mock-services";

const MOCK = 8790, PORT = 8787, B = `http://127.0.0.1:${PORT}`, M = `http://127.0.0.1:${MOCK}`;
const results: string[] = [];
const ok = (name: string) => { results.push(name); console.log("PASS", name); };

class Visitor {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const r = await fetch(B + path, { signal: AbortSignal.timeout(20000), method, headers: { "content-type": "application/json", ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) this.cookie = sc.split(";")[0]!;
    return { status: r.status, j: (await r.json()) as any };
  }
}
const mock = async (p: string, body?: unknown) => (await fetch(M + p, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json() as Promise<any>;

async function main() {
  const srv = await startMock(MOCK);
  const w = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1",
    "--var", `PAYPAL_BASE:${M}`, "--var", "PAYPAL_CLIENT_ID:test-client", "--var", "PAYPAL_CLIENT_SECRET:test-secret",
    "--var", `GEMINI_BASE:${M}`, "--var", "GEMINI_API_KEY:test-key", "--var", "AI_PER_VISITOR_PER_HOUR:6"], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
  let log = ""; w.stdout.on("data", (d) => (log += d)); w.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120 && !/Ready on/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
  if (!/Ready on/.test(log)) throw new Error("wrangler 沒啟動\n" + log.slice(-2000));
  try {
    const a = new Visitor();
    let r = await a.call("GET", "/api/board");
    assert.equal(r.j.phase, "購物車"); assert.ok(a.cookie.startsWith("pb_vid="));

    r = await a.call("POST", "/api/say", { text: "幫我買兩杯拿鐵，預算 20 美元" });
    assert.equal(r.j.aiSource, "gemini"); assert.equal(r.j.phase, "待批准提案");
    assert.deepEqual(r.j.proposal.cart, { latte: 2 }, "AI 亂加的商品（rocket）要被擋掉");
    assert.deepEqual(r.j.cart, {}, "AI 提案不能直接改購物車");
    assert.equal(r.j.budgetCents, 2000);
    ok("AI 提案只是提案：購物車沒變、價目表沒有的商品被擋、預算記下");

    r = await a.call("POST", "/api/paypal/create-order");
    assert.equal(r.status, 409); ok("沒批准結帳不能建單");

    r = await a.call("POST", "/api/proposal/accept");
    assert.deepEqual(r.j.cart, { latte: 2 }); assert.equal(r.j.total, 900);
    r = await a.call("POST", "/api/cart", { cart: { latte: 2, hacker: 1 }, total: 1 });
    assert.deepEqual(r.j.cart, { latte: 2 }); assert.equal(r.j.total, 900);
    ok("人批准提案；瀏覽器送假商品、假總額都沒用，金額由伺服器價目表算（$9.00）");

    r = await a.call("POST", "/api/checkout/lock"); assert.equal(r.j.phase, "已鎖定"); assert.equal(r.j.lock.totalCents, 900);
    const o1 = await a.call("POST", "/api/paypal/create-order");
    const o2 = await a.call("POST", "/api/paypal/create-order");
    assert.equal(o1.j.orderID, o2.j.orderID); assert.equal(o2.j.reused, true);
    let s = await mock("/mock/stats"); assert.equal(s.creates, 1); assert.equal(s.orders[0].value, "9.00");
    ok("批准結帳後建單：連按兩次只建一張 PayPal 訂單，金額 9.00");

    r = await a.call("POST", "/api/paypal/capture", { orderID: o1.j.orderID });
    assert.equal(r.status, 409); assert.equal(r.j.error, "NOT_APPROVED");
    ok("買家還沒在 PayPal 核准，伺服器自己查證後拒絕收款（不相信瀏覽器）");

    await mock(`/mock/approve/${o1.j.orderID}`);
    r = await a.call("POST", "/api/paypal/capture", { orderID: o1.j.orderID });
    assert.equal(r.j.phase, "已收款"); assert.equal(r.j.receipt.totalCents, 900); assert.match(r.j.receipt.captureId, /^CAPTURE-/);
    const again = await Promise.all([1, 2, 3].map(() => a.call("POST", "/api/paypal/capture", { orderID: o1.j.orderID })));
    assert.ok(again.every((x) => x.j.receipt?.captureId === r.j.receipt.captureId));
    s = await mock("/mock/stats"); assert.equal(s.captures, 1);
    ok("買家核准後收款，回執回到白板；同時再送 3 次收款，PayPal 只扣 1 次");

    const ev = r.j.events.map((e: any) => `${e.who}:${e.what.split("（")[0]}`);
    assert.ok(ev.some((e: string) => e.startsWith("ai:AI 提案")) && ev.some((e: string) => e.startsWith("human:人批准結帳")) && ev.some((e: string) => e.startsWith("paypal:買家")) && ev.some((e: string) => e.startsWith("server:收款")));
    ok("事件紀錄分清楚：AI 提案、人批准結帳、PayPal 買家核准、伺服器收款");

    // 第二輪：批准結帳後改購物車 → 鎖定作廢
    const b = new Visitor();
    await b.call("POST", "/api/cart", { cart: { bagel: 2 } });
    await b.call("POST", "/api/checkout/lock");
    r = await b.call("POST", "/api/cart", { cart: { bagel: 3 } });
    assert.equal(r.j.lock, null); assert.equal(r.j.phase, "購物車");
    r = await b.call("POST", "/api/paypal/create-order"); assert.equal(r.status, 409);
    ok("批准結帳後改購物車：批准作廢，要重新批准才能建單");

    r = await b.call("POST", "/api/budget", { cents: 500 });
    r = await b.call("POST", "/api/checkout/lock"); assert.equal(r.j.error, "OVER_BUDGET");
    ok("超過預算不能批准結帳（$9.00 > $5.00）");

    r = await b.call("GET", "/api/board"); assert.equal(r.j.receipt, null);
    ok("訪客互相隔離：第二位訪客看不到第一位的回執");

    await mock("/mock/gemini-fail", { fail: true });
    const c = new Visitor();
    r = await c.call("POST", "/api/say", { text: "三個可頌" });
    assert.equal(r.j.aiSource, "local"); assert.deepEqual(r.j.proposal.cart, { croissant: 3 }); assert.match(r.j.proposal.note, /本機規則/);
    await mock("/mock/gemini-fail", { fail: false });
    ok("Gemini 掛掉時改用本機規則，並明白寫出來");

    let last = 0;
    for (let i = 0; i < 6; i++) last = (await c.call("POST", "/api/say", { text: "一瓶水" })).status;
    assert.equal(last, 429);
    ok("每位訪客每小時問 AI 有上限（保護免費額度到評審結束）");

    console.log(`\n合計 ${results.length}/${results.length} PASS`);
  } finally {
    try { process.kill(-w.pid!, "SIGTERM"); } catch {} srv.close();
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL", e); process.exit(1); });
