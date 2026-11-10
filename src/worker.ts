/**
 * PayBoard 薄後端：每位訪客一個「房間」（Durable Object，同一時間只處理一個請求，不會互相搶）。
 * 所有改變都只走 src/law.ts 的 step()；PayPal 回來的結果也要先由伺服器向 PayPal 查證才算數。
 */
import { DurableObject } from "cloudflare:workers";
import { CATALOG, LawError, SKUS, freshBoard, step, totalCents, type Board } from "./law";
import { aiPropose } from "./ai";
import { captureOrder, createOrder, getOrder } from "./paypal";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  LIMIT: DurableObjectNamespace<Limiter>;
  ASSETS: Fetcher;
  GEMINI_API_KEY?: string;
  GEMINI_BASE?: string;
  GEMINI_MODEL?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_BASE?: string;
  AI_PER_VISITOR_PER_HOUR?: string;
  AI_GLOBAL_PER_DAY?: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/config")
      return json({ paypalClientId: env.PAYPAL_CLIENT_ID ?? null, ai: env.GEMINI_API_KEY ? "gemini" : "local", catalog: SKUS.map((s) => ({ sku: s, ...CATALOG[s] })) });
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    // 訪客編號：沒有就發一個（每位訪客自己的沙盒）
    const m = (req.headers.get("cookie") ?? "").match(/(?:^|;\s*)pb_vid=([a-f0-9-]{36})/);
    const vid = m?.[1] ?? crypto.randomUUID();
    const stub = env.ROOM.get(env.ROOM.idFromName(vid));
    const res = await stub.fetch(req);
    if (m) return res;
    const out = new Response(res.body, res);
    out.headers.append("set-cookie", `pb_vid=${vid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${url.protocol === "https:" ? "; Secure" : ""}`);
    return out;
  },
};

/** 全站 AI 用量上限（保護免費額度到 12/15 評審結束） */
export class Limiter extends DurableObject<Env> {
  async take(max: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const cur = ((await this.ctx.storage.get<{ day: string; n: number }>("c")) ?? { day, n: 0 });
    const c = cur.day === day ? cur : { day, n: 0 };
    if (c.n >= max) return false;
    await this.ctx.storage.put("c", { day, n: c.n + 1 });
    return true;
  }
}

export class Room extends DurableObject<Env> {
  private async load(): Promise<Board> {
    return (await this.ctx.storage.get<Board>("board")) ?? freshBoard();
  }
  private async save(b: Board) {
    await this.ctx.storage.put("board", b);
    return b;
  }
  private view(b: Board) {
    return { ...b, total: totalCents(b.cart), proposalTotal: b.proposal ? totalCents(b.proposal.cart) : null, captures: undefined };
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};
    let b = await this.load();
    try {
      switch (`${req.method} ${path}`) {
        case "GET /api/board":
          return json(this.view(b));
        case "POST /api/reset":
          return json(this.view(await this.save(freshBoard())));
        case "POST /api/say": {
          const text = String(body.text ?? "").trim().slice(0, 500);
          if (!text) return json({ error: "EMPTY" }, 400);
          if (!(await this.takeHourly(Number(this.env.AI_PER_VISITOR_PER_HOUR ?? 20))))
            return json({ error: "RATE_LIMIT", message: "這一小時問 AI 的次數用完了，晚點再試。" }, 429);
          const global = this.env.LIMIT.get(this.env.LIMIT.idFromName("global"));
          const useAi = await global.take(Number(this.env.AI_GLOBAL_PER_DAY ?? 1000));
          const r = await aiPropose(text, b.cart, b.budgetCents, useAi ? this.env : {});
          if (r.budgetCents !== null && r.budgetCents !== b.budgetCents && (b.phase === "購物車" || b.phase === "待批准提案")) b = step(b, { t: "SET_BUDGET", cents: r.budgetCents }, "human");
          b = step(b, { t: "AI_PROPOSE", cart: r.cart, note: r.note, id: `p-${crypto.randomUUID().slice(0, 8)}` }, "ai");
          return json({ ...this.view(await this.save(b)), aiSource: r.source, ...(r.diagnostic ? { aiDiagnostic: r.diagnostic } : {}) });
        }
        case "POST /api/proposal/accept":
          return json(this.view(await this.save(step(b, { t: "ACCEPT_PROPOSAL" }, "human"))));
        case "POST /api/proposal/reject":
          return json(this.view(await this.save(step(b, { t: "REJECT_PROPOSAL" }, "human"))));
        case "POST /api/cart":
          return json(this.view(await this.save(step(b, { t: "EDIT_CART", cart: body.cart }, "human"))));
        case "POST /api/budget":
          return json(this.view(await this.save(step(b, { t: "SET_BUDGET", cents: body.cents == null ? null : Math.round(Number(body.cents)) }, "human"))));
        case "POST /api/checkout/lock":
          return json(this.view(await this.save(step(b, { t: "LOCK_FOR_CHECKOUT", id: crypto.randomUUID() }, "human"))));
        case "POST /api/checkout/cancel":
          return json(this.view(await this.save(step(b, { t: "CANCEL" }, "human"))));
        case "POST /api/paypal/create-order": {
          if (b.phase === "已建單" && b.order) return json({ orderID: b.order.id, reused: true }); // 重按不會再建一張
          if (b.phase !== "已鎖定" || !b.lock) throw new LawError("NOT_LOCKED", "要先按「批准結帳」");
          const o = await createOrder(this.env, b.lock.totalCents, b.lock.id);
          await this.save(step(b, { t: "ORDER_CREATED", orderId: o.id }, "server"));
          return json({ orderID: o.id });
        }
        case "POST /api/paypal/capture": {
          const orderId = String(body.orderID ?? "");
          if (b.phase === "已收款" && b.receipt?.orderId === orderId) return json({ ...this.view(b), reused: true });
          if (b.order?.id !== orderId) throw new LawError("ORDER_MISMATCH", "不是這張訂單");
          if (b.order.status !== "APPROVED") {
            // 不相信瀏覽器說「已核准」：伺服器自己問 PayPal
            const o = await getOrder(this.env, orderId);
            if (o.status !== "APPROVED") throw new LawError("NOT_APPROVED", `PayPal 顯示 ${o.status}，買家還沒核准`);
            if (o.cents !== b.lock!.totalCents) throw new LawError("AMOUNT_MISMATCH", "PayPal 訂單金額和批准金額不同");
            b = await this.save(step(b, { t: "BUYER_APPROVED", orderId }, "paypal"));
          }
          const c = await captureOrder(this.env, orderId, b.lock!.id);
          if (c.status !== "COMPLETED" || c.captureStatus !== "COMPLETED") throw new LawError("CAPTURE_PENDING", `收款狀態 ${c.captureStatus || c.status}`);
          b = await this.save(step(b, { t: "CAPTURED", orderId, captureId: c.captureId, totalCents: c.cents, at: new Date().toISOString() }, "server"));
          return json(this.view(b));
        }
        default:
          return json({ error: "NOT_FOUND" }, 404);
      }
    } catch (e) {
      if (e instanceof LawError) return json({ error: e.code, message: e.message, board: this.view(b) }, 409);
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: msg.startsWith("PAYPAL") ? msg : "SERVER_ERROR", message: msg, board: this.view(b) }, 502);
    }
  }

  private async takeHourly(max: number) {
    const hour = new Date().toISOString().slice(0, 13);
    const cur = (await this.ctx.storage.get<{ hour: string; n: number }>("ai")) ?? { hour, n: 0 };
    const c = cur.hour === hour ? cur : { hour, n: 0 };
    if (c.n >= max) return false;
    await this.ctx.storage.put("ai", { hour, n: c.n + 1 });
    return true;
  }
}
