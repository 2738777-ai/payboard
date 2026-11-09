// 付款法典窮舉檢查：所有「誰 × 做什麼」的順序走到第 7 步，檢查不變量；再拿 4 種錯法咬一次。
import assert from "node:assert/strict";
import { LAW, LawError, cleanCart, freshBoard, step, totalCents, type Actor, type Board, type Cmd } from "../src/law";

type Step = (b: Board, c: Cmd, w: Actor) => Board;
const ACTORS: Actor[] = ["human", "ai", "paypal", "server"];
const CMDS: Cmd[] = [
  { t: "AI_PROPOSE", cart: { latte: 2, hacker: 99 } as never, note: "兩杯拿鐵", id: "p1" },
  { t: "ACCEPT_PROPOSAL" },
  { t: "REJECT_PROPOSAL" },
  { t: "EDIT_CART", cart: { croissant: 1 } },
  { t: "SET_BUDGET", cents: 500 },
  { t: "LOCK_FOR_CHECKOUT", id: "lock-1" },
  { t: "ORDER_CREATED", orderId: "o1" },
  { t: "BUYER_APPROVED", orderId: "o1" },
  { t: "CAPTURED", orderId: "o1", captureId: "c1", totalCents: -1, at: "t" }, // -1 → 填伺服器鎖定金額
  { t: "CAPTURED", orderId: "o1", captureId: "c1", totalCents: 1, at: "t" }, // 竄改金額
  { t: "CANCEL" },
];
const fill = (b: Board, c: Cmd): Cmd => (c.t === "CAPTURED" && c.totalCents === -1 ? { ...c, totalCents: b.lock?.totalCents ?? 0 } : c);

function check(stepFn: Step, depth = 7) {
  const bad = new Set<string>();
  let paths = 0;
  const walk = (b: Board, hist: { c: Cmd; w: Actor; before: Board }[]) => {
    paths++;
    if (b.captures > 1) bad.add("重複扣款");
    if (b.phase === "已收款") {
      const lockAt = hist.findLastIndex((h) => h.c.t === "LOCK_FOR_CHECKOUT");
      const lockBoard = lockAt >= 0 ? hist[lockAt]!.before : null;
      if (!lockBoard || hist[lockAt]!.w !== "human") bad.add("沒經過人批准結帳就收款");
      else if (b.receipt!.totalCents !== totalCents(lockBoard.cart)) bad.add("扣款金額≠人批准時購物車的金額");
      if (lockAt >= 0 && hist.slice(lockAt).some((h) => h.c.t === "EDIT_CART")) bad.add("批准後改了購物車還收款");
      if (!hist.slice(Math.max(lockAt, 0)).some((h) => h.c.t === "BUYER_APPROVED" && h.w === "paypal")) bad.add("買家沒在 PayPal 核准就收款");
    }
    if (b.lock && b.lock.version !== b.version) bad.add("鎖定的版本和目前購物車不同");
    if (b.lock && b.budgetCents != null && b.lock.totalCents > b.budgetCents) bad.add("超過預算還能結帳");
    if (hist.length >= depth) return;
    for (const raw of CMDS)
      for (const w of ACTORS) {
        const c = fill(b, raw);
        let nb: Board;
        try {
          nb = stepFn(b, c, w);
        } catch (e) {
          if (!(e instanceof LawError)) throw e;
          continue;
        }
        if (w === "ai" && c.t !== "AI_PROPOSE") bad.add(`AI 能做 ${c.t}`);
        if (w === "ai" && (nb.version !== b.version || JSON.stringify(nb.cart) !== JSON.stringify(b.cart))) bad.add("AI 直接改了購物車");
        if (nb.proposal && Object.keys(nb.proposal.cart).some((k) => !["latte", "americano", "croissant", "bagel", "water"].includes(k))) bad.add("提案混進價目表沒有的商品");
        walk(nb, [...hist, { c, w, before: b }]);
      }
  };
  walk(freshBoard(), []);
  return { bad: [...bad].sort(), paths };
}

const real = check(step);
assert.deepEqual(real.bad, [], real.bad.join("、"));
console.log(`PASS_PAY_LAW: 走了 ${real.paths.toLocaleString()} 種順序，問題 0 個`);

// ── 咬：四種錯法都要被抓到 ──
const bites: [string, () => Step, string][] = [
  ["AI 也能批准結帳", () => {
    LAW.LOCK_FOR_CHECKOUT.who.push("ai");
    return step;
  }, "AI 能做 LOCK_FOR_CHECKOUT"],
  ["收款重送會再扣一次", () => (b, c, w) => (c.t === "CAPTURED" && b.phase === "已收款" ? { ...b, captures: b.captures + 1 } : step(b, c, w)), "重複扣款"],
  ["改購物車不作廢鎖定", () => (b, c, w) => (c.t === "EDIT_CART" && b.lock ? { ...b, cart: cleanCart(c.cart), version: b.version + 1 } : step(b, c, w)), "鎖定的版本和目前購物車不同"],
  ["相信瀏覽器送來的金額", () => (b, c, w) => {
    if (c.t !== "CAPTURED" || b.phase !== "已建單" || b.order?.status !== "APPROVED" || w !== "server") return step(b, c, w);
    return { ...b, phase: "已收款", receipt: { orderId: c.orderId, captureId: c.captureId, totalCents: c.totalCents, at: c.at }, captures: b.captures + 1 };
  }, "扣款金額≠人批准時購物車的金額"],
];
for (const [name, make, expect] of bites) {
  const saved = LAW.LOCK_FOR_CHECKOUT.who.slice();
  const r = check(make(), 7);
  LAW.LOCK_FOR_CHECKOUT.who = saved;
  assert.ok(r.bad.includes(expect), `咬「${name}」沒抓到，只看到：${r.bad.join("、")}`);
  console.log(`咬「${name}」→ 抓到：${r.bad.join("、")}`);
}
console.log("PASS_PAY_LAW_BITES: 4 種錯法全部被抓到");
