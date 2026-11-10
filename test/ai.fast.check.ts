// Gemma 4 fast path regression: real Workers AI is prioritized over Gemini, produces a proposal, never commits the cart.
import assert from "node:assert/strict";
import { aiPropose, type AiBinding } from "../src/ai";

async function main() {
  let calls = 0;
  const ai: AiBinding = {
    async run(model, input) {
      calls++;
      assert.equal(model, "@cf/google/gemma-4-26b-a4b-it");
      assert.equal(input.response_format.type, "json_object");
      assert.equal(input.chat_template_kwargs.enable_thinking, false, "do not use extended thinking for short cart JSON");
      assert.ok(input.max_completion_tokens <= 256 && input.max_completion_tokens >= 128);
      assert.equal(input.temperature, 0.2);
      return { choices: [{ message: { content: JSON.stringify({
        items: [{ sku: "americano", qty: 1 }, { sku: "bagel", qty: 1 }],
        budget_usd: 7, note: "已挑選不超過預算的早餐",
      }) } }] };
    },
  };
  const noGemini = (async () => { throw new Error("Gemini must not be called when AI binding is available"); }) as typeof fetch;
  const r = await aiPropose("我只有 7 美元，想喝咖啡又想吃早餐，不超支", {}, null,
    { AI: ai, GEMINI_API_KEY: "must-not-call" }, noGemini);
  assert.equal(calls, 1);
  assert.equal(r.source, "workers-ai");
  assert.deepEqual(r.cart, { americano: 1, bagel: 1 });
  assert.equal(r.budgetCents, 700);
  const failed = await aiPropose("兩杯拿鐵", {}, null,
    { AI: { run: async () => { throw new Error("model unavailable"); } } });
  assert.equal(failed.source, "local");
  assert.deepEqual(failed.cart, { latte: 2 });
  console.log("PASS_AI_FAST_PATH: no reasoning, bounded output, Workers AI first, local fallback still labeled");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
