/**
 * PayBoard 付款法典 v2 —— 先寫表，Worker 只照表走，tests/law.check.ts 窮舉檢查。
 *
 * 三次決定，各自分開：
 *   1. AI 提案改購物車（只是提案，不動購物車）        → 只有 AI
 *   2. 人批准提案、或自己改購物車                     → 只有人
 *   3. 人按「批准結帳」鎖定購物車版本（不付款）        → 只有人
 *   4. 買家在 PayPal 視窗按核准（PayPal 回呼）         → 只有 PayPal
 *   5. 伺服器確認後收款，回執回白板                   → 只有伺服器
 * 金額永遠由伺服器用自己的價目表重算，不信任瀏覽器送來的總額。
 * 每次批准結帳產生一個穩定的請求編號，建單與收款都帶它 → 重送不會重複扣款。
 */

export type Sku = "latte" | "americano" | "croissant" | "bagel" | "water";
/** 伺服器自己的價目表（美元，分為單位避免小數誤差） */
export const CATALOG: Record<Sku, { name: string; zh: string; cents: number }> = {
  latte: { name: "Latte", zh: "拿鐵", cents: 450 },
  americano: { name: "Americano", zh: "美式", cents: 350 },
  croissant: { name: "Croissant", zh: "可頌", cents: 380 },
  bagel: { name: "Bagel", zh: "貝果", cents: 300 },
  water: { name: "Water", zh: "礦泉水", cents: 150 },
};
export const SKUS = Object.keys(CATALOG) as Sku[];
export const MAX_QTY = 9;

export type Cart = Partial<Record<Sku, number>>;
export type Phase = "購物車" | "待批准提案" | "已鎖定" | "已建單" | "已收款";
export type Actor = "human" | "ai" | "paypal" | "server";
export type Proposal = { id: string; cart: Cart; note: string; by: "ai" };
export type Board = {
  phase: Phase;
  version: number; // 購物車每改一次 +1
  cart: Cart;
  budgetCents: number | null;
  proposal: Proposal | null;
  lock: { id: string; version: number; totalCents: number } | null; // 批准結帳鎖定
  order: { id: string; status: "CREATED" | "APPROVED" | "COMPLETED"; requestId: string } | null;
  receipt: { orderId: string; captureId: string; totalCents: number; at: string } | null;
  captures: number; // 檢查用：實際扣款次數
  events: { n: number; at: string; who: Actor; what: string }[];
};

export type Cmd =
  | { t: "AI_PROPOSE"; cart: Cart; note: string; id: string }
  | { t: "ACCEPT_PROPOSAL" }
  | { t: "REJECT_PROPOSAL" }
  | { t: "EDIT_CART"; cart: Cart }
  | { t: "SET_BUDGET"; cents: number | null }
  | { t: "LOCK_FOR_CHECKOUT"; id: string }
  | { t: "ORDER_CREATED"; orderId: string }
  | { t: "BUYER_APPROVED"; orderId: string }
  | { t: "CAPTURED"; orderId: string; captureId: string; totalCents: number; at: string }
  | { t: "CANCEL" };

/** 法典本體：每個指令誰能做、在哪些階段能做。沒寫的一律拒絕。 */
export const LAW: Record<Cmd["t"], { who: Actor[]; from: Phase[] }> = {
  AI_PROPOSE: { who: ["ai"], from: ["購物車", "待批准提案"] },
  ACCEPT_PROPOSAL: { who: ["human"], from: ["待批准提案"] },
  REJECT_PROPOSAL: { who: ["human"], from: ["待批准提案"] },
  EDIT_CART: { who: ["human"], from: ["購物車", "待批准提案", "已鎖定", "已建單"] },
  SET_BUDGET: { who: ["human"], from: ["購物車", "待批准提案"] },
  LOCK_FOR_CHECKOUT: { who: ["human"], from: ["購物車"] },
  ORDER_CREATED: { who: ["server"], from: ["已鎖定"] },
  BUYER_APPROVED: { who: ["paypal"], from: ["已建單"] },
  CAPTURED: { who: ["server"], from: ["已建單", "已收款"] },
  CANCEL: { who: ["human"], from: ["待批准提案", "已鎖定", "已建單"] },
};

export class LawError extends Error {
  constructor(public code: string, msg: string) {
    super(msg);
  }
}

export function cleanCart(c: unknown): Cart {
  const out: Cart = {};
  if (!c || typeof c !== "object") return out;
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    if (!(SKUS as string[]).includes(k)) continue; // 價目表沒有的商品一律丟掉
    const q = Math.floor(Number(v));
    if (q > 0) out[k as Sku] = Math.min(q, MAX_QTY);
  }
  return out;
}
/** 金額只看伺服器價目表 */
export const totalCents = (c: Cart) => SKUS.reduce((s, k) => s + (c[k] ?? 0) * CATALOG[k].cents, 0);

export function freshBoard(): Board {
  return { phase: "購物車", version: 1, cart: {}, budgetCents: null, proposal: null, lock: null, order: null, receipt: null, captures: 0, events: [] };
}

const log = (b: Board, who: Actor, what: string, at: string): Board => ({
  ...b,
  events: [...b.events, { n: (b.events.at(-1)?.n ?? 0) + 1, at, who, what }].slice(-200),
});

export function step(b: Board, cmd: Cmd, who: Actor, at = new Date().toISOString()): Board {
  const rule = LAW[cmd.t];
  if (!rule.who.includes(who)) throw new LawError("NOT_ALLOWED", `${who} 不能做 ${cmd.t}`);
  if (!rule.from.includes(b.phase)) throw new LawError("WRONG_PHASE", `${b.phase} 階段不能做 ${cmd.t}`);
  switch (cmd.t) {
    case "AI_PROPOSE": {
      const cart = cleanCart(cmd.cart);
      return log({ ...b, phase: "待批准提案", proposal: { id: cmd.id, cart, note: cmd.note.slice(0, 280), by: "ai" } }, who, `AI 提案 ${cmd.id}（$${(totalCents(cart) / 100).toFixed(2)}）`, at);
    }
    case "ACCEPT_PROPOSAL":
      return log({ ...b, phase: "購物車", cart: b.proposal!.cart, version: b.version + 1, proposal: null }, who, `人批准提案 ${b.proposal!.id}`, at);
    case "REJECT_PROPOSAL":
      return log({ ...b, phase: "購物車", proposal: null }, who, `人拒絕提案 ${b.proposal!.id}`, at);
    case "EDIT_CART":
      // 改購物車：任何鎖定與未付款訂單都作廢，要重新批准
      return log({ ...b, phase: "購物車", cart: cleanCart(cmd.cart), version: b.version + 1, proposal: null, lock: null, order: null }, who, "人改購物車（鎖定與訂單作廢）", at);
    case "SET_BUDGET":
      return log({ ...b, budgetCents: cmd.cents }, who, `預算 ${cmd.cents == null ? "無" : "$" + (cmd.cents / 100).toFixed(2)}`, at);
    case "LOCK_FOR_CHECKOUT": {
      const t = totalCents(b.cart);
      if (t <= 0) throw new LawError("EMPTY_CART", "購物車是空的");
      if (b.budgetCents != null && t > b.budgetCents) throw new LawError("OVER_BUDGET", "超過預算");
      return log({ ...b, phase: "已鎖定", lock: { id: cmd.id, version: b.version, totalCents: t } }, who, `人批准結帳 ${cmd.id}（$${(t / 100).toFixed(2)}，不付款）`, at);
    }
    case "ORDER_CREATED":
      return log({ ...b, phase: "已建單", order: { id: cmd.orderId, status: "CREATED", requestId: b.lock!.id } }, who, `PayPal 訂單 ${cmd.orderId}`, at);
    case "BUYER_APPROVED":
      if (b.order?.id !== cmd.orderId) throw new LawError("ORDER_MISMATCH", "不是這張訂單");
      return log({ ...b, order: { ...b.order, status: "APPROVED" } }, who, `買家在 PayPal 核准 ${cmd.orderId}`, at);
    case "CAPTURED": {
      if (b.phase === "已收款") return b; // 重送：同一個回執，不再記一次
      if (b.order?.id !== cmd.orderId || b.order.status !== "APPROVED") throw new LawError("NOT_APPROVED", "買家還沒核准");
      if (cmd.totalCents !== b.lock!.totalCents) throw new LawError("AMOUNT_MISMATCH", "收款金額和批准金額不同");
      return log(
        { ...b, phase: "已收款", order: { ...b.order, status: "COMPLETED" }, receipt: { orderId: cmd.orderId, captureId: cmd.captureId, totalCents: cmd.totalCents, at: cmd.at }, captures: b.captures + 1 },
        who, `收款 ${cmd.captureId}（$${(cmd.totalCents / 100).toFixed(2)}）`, at);
    }
    case "CANCEL":
      return log({ ...b, phase: "購物車", proposal: null, lock: null, order: null }, who, "人取消", at);
  }
}
