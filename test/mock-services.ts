// 本機假 PayPal（照 Orders v2 行為，含 PayPal-Request-Id 冪等）＋假 Gemini。只給測試用。
import http from "node:http";

type Order = { id: string; status: "CREATED" | "APPROVED" | "COMPLETED"; value: string; captureId?: string };
const orders = new Map<string, Order>();
const byRequestId = new Map<string, unknown>();
export const stats = { creates: 0, captures: 0, gemini: 0, geminiFail: false };

const send = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export function startMock(port: number) {
  const srv = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url!, "http://x");
    const rid = req.headers["paypal-request-id"] as string | undefined;
    const p = url.pathname;
    if (p === "/v1/oauth2/token") return send(res, 200, { access_token: "tok", expires_in: 3600 });
    if (p === "/v2/checkout/orders" && req.method === "POST") {
      if (rid && byRequestId.has(rid)) return send(res, 201, byRequestId.get(rid));
      stats.creates++;
      const body = JSON.parse(raw);
      const o: Order = { id: `ORDER-${stats.creates}`, status: "CREATED", value: body.purchase_units[0].amount.value };
      orders.set(o.id, o);
      const out = { id: o.id, status: o.status };
      if (rid) byRequestId.set(rid, out);
      return send(res, 201, out);
    }
    let m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (m && req.method === "GET") {
      const o = orders.get(m[1]!);
      if (!o) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      return send(res, 200, { id: o.id, status: o.status, purchase_units: [{ amount: { currency_code: "USD", value: o.value } }] });
    }
    m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (m && req.method === "POST") {
      if (rid && byRequestId.has(rid)) return send(res, 201, byRequestId.get(rid));
      const o = orders.get(m[1]!);
      if (!o) return send(res, 404, { name: "RESOURCE_NOT_FOUND" });
      if (o.status === "COMPLETED") return send(res, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] });
      if (o.status !== "APPROVED") return send(res, 422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED" }] });
      stats.captures++;
      o.status = "COMPLETED";
      o.captureId = `CAPTURE-${stats.captures}`;
      const out = { id: o.id, status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: o.captureId, status: "COMPLETED", amount: { currency_code: "USD", value: o.value } }] } }] };
      if (rid) byRequestId.set(rid, out);
      return send(res, 201, out);
    }
    m = p.match(/^\/mock\/approve\/([^/]+)$/); // 模擬買家在 PayPal 視窗按核准
    if (m) {
      const o = orders.get(m[1]!);
      if (o && o.status === "CREATED") o.status = "APPROVED";
      return send(res, 200, { ok: !!o });
    }
    if (p === "/mock/stats") return send(res, 200, { ...stats, orders: [...orders.values()] });
    if (p === "/mock/gemini-fail") { stats.geminiFail = JSON.parse(raw).fail; return send(res, 200, { ok: true }); }
    if (p.includes(":generateContent")) {
      stats.gemini++;
      if (stats.geminiFail) return send(res, 503, { error: "UNAVAILABLE" });
      const said = JSON.parse(raw).contents[0].parts[0].text.split("Shopper said:")[1] ?? "";
      const items = /拿鐵|latte/i.test(said) ? [{ sku: "latte", qty: 2 }, { sku: "rocket", qty: 1 }] : [{ sku: "water", qty: 1 }];
      const budget = /20/.test(said) ? 20 : null;
      return send(res, 200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items, budget_usd: budget, note: "提議兩杯拿鐵，共 $9.00，在預算內。" }) }] } }] });
    }
    send(res, 404, { name: "NOT_FOUND" });
  });
  return new Promise<http.Server>((ok) => srv.listen(port, "127.0.0.1", () => ok(srv)));
}
