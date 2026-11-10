# PayBoard — Human-Controlled AI Commerce

**A real AI can propose a shopping cart. Only a human can authorize checkout. A deterministic server-side payment law prevents unauthorized or over-budget PayPal captures.**

[Try the live Sandbox demo](https://payboard.2738777.workers.dev/) · [Watch the 75-second demo](https://youtube.com/shorts/Wc89S-c935A) · [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/)

> **Sandbox only.** PayBoard uses test money and PayPal Sandbox accounts. It is **not** a production payment service. Never enter live card credentials or real PayPal production secrets.

## What makes it different?

A shopping assistant can make mistakes. PayBoard is designed so that a model's incorrect recommendation **cannot itself result in a payment**.

In the recorded demonstration, a user sets an **$8.00 budget**. Cloudflare Workers AI / Gemma 4 recommends a **$4.50 latte + $3.80 croissant = $8.30**. Even if the human accepts that proposal, PayBoard **refuses checkout** until the human replaces the latte with a **$3.50 Americano**, bringing the total to **$7.30**. The buyer then approves a real PayPal **Sandbox** order, and the backend verifies the approved amount before capture. The UI displays the PayPal Order ID, Capture ID, and session event history.

The error is part of the demonstration: **AI is allowed to be wrong; the payment guardrail is not delegated to AI.**

## How it works

1. **Request:** A shopper types a natural-language request, in English or Chinese, including a budget.
2. **AI proposes:** Cloudflare Workers AI (Gemma 4) returns a structured proposed cart and optional budget. The existing cart is unchanged until human approval. The UI identifies the source and measured server-side AI call latency.
3. **Human reviews:** The shopper approves, rejects, or manually changes the cart. Manually edited carts do not require AI approval.
4. **Deterministic checkout law:** TypeScript state transitions enforce actor/phase permissions. The server calculates prices from its own allow-listed catalog, validates the budget, and locks the cart's version and amount before checkout.
5. **PayPal Orders v2:** The backend creates a Sandbox order only for a valid locked cart. PayPal SDK prompts the buyer to approve it.
6. **Capture:** The backend retrieves the PayPal order, checks buyer approval and amount, then captures using a stable idempotency key.
7. **Receipt and audit:** The browser shows Order ID and Capture ID. A per-session event history identifies human, AI, PayPal, and server actions.

### Security boundaries

- AI **cannot** approve a proposal, lock checkout, create an order, or capture a payment by itself.
- The browser's submitted price or total is **never trusted**; the server determines all USD cents.
- An over-budget cart **cannot** be locked for checkout, even when its AI proposal was accepted.
- Cart changes invalidate an earlier checkout lock and pending order state.
- Buyer approval is checked against PayPal server-to-server before capture.
- Stable `PayPal-Request-Id` values and state checks reduce duplicate create/capture operations.
- Each visitor's board lives in a separate Cloudflare Durable Object keyed by a session cookie.
- The event log holds the **latest 200 session events** and is resettable; it is *not* advertised as an immutable external ledger.
- If model inference fails, the program clearly labels its limited local-rule fallback as **not AI**.

## Architecture

```text
Mobile / desktop browser (English UI + multilingual input)
     |
     |  /api/say
     v
Cloudflare Worker + Durable Objects
     |-- Workers AI: Gemma 4 -> structured cart proposal
     |-- deterministic payment law (src/law.ts)
     |-- per-session state + bounded event history
     |
     |  human approves proposal, then separately locks checkout
     v
PayPal JavaScript SDK (buyer approves in Sandbox)
     |
     v
Server: PayPal Orders v2 -> verify approval / amount -> Capture
     |
     v
Order ID + Capture ID + event history shown in the browser
```

**Stack:** Cloudflare Workers, Workers AI / Gemma 4, TypeScript, Durable Objects, PayPal Orders v2 REST API, PayPal JavaScript SDK. Gemini integration exists as an alternative provider if the Workers AI binding is not configured; a labeled local parser is the last-resort fallback.

## Try the working demo (judges)

1. Open **https://payboard.2738777.workers.dev/** on mobile or desktop. No PayBoard login is required.
2. Start a new shopping session. Switch the interface to English if desired.
3. Enter **"My budget is $8. Recommend a coffee and breakfast."** or the Chinese equivalent.
4. Inspect the AI source and proposed cart. The proposal alone cannot change the cart.
5. Approve or reject. If the cart is over budget, checkout remains disabled; use the product controls to replace or remove an item.
6. Once within budget, click **Approve checkout (no payment)**, then the yellow **PayPal** button.
7. **To complete a payment:** use a *Personal Sandbox buyer account* from your own PayPal Developer Dashboard (Testing Tools → Sandbox Accounts). This is a test transaction, not real money. Do not use a real PayPal login. Approval is then reflected in PayBoard as an Order ID, Capture ID, and session event trail.
8. Open **Auditable event history** to inspect the progression.

Anyone can inspect AI proposals, budget blocking, human approvals, and event history without a PayPal test buyer. A PayPal Sandbox Personal buyer login is needed only for the final simulated payment approval. Judges can create a free test buyer at [PayPal Developer](https://developer.paypal.com/).

## Run locally / reproduce the checks

Requirements: **Node.js 22+**, npm. Local mocked integration tests **do not require live PayPal credentials**.

```bash
git clone https://github.com/2738777-ai/payboard.git
cd payboard
npm ci
npm test
npx tsc --noEmit
```

`npm test` runs:

- Fast-path AI contract checks and labeled fallback behavior.
- `test/law.check.ts`: 24,134 state transition paths and four adversarial law mutations (as checked in the validated run).
- `test/flow.test.ts`: 12 local end-to-end payment-flow checks with mock PayPal/Gemini services, including budget blocking, approval verification, idempotency, and visitor isolation.

To run your own Worker locally, use the documented `wrangler.toml` and Wrangler CLI. Only set sandbox credentials in local `.dev.vars` or Wrangler Secrets (never commit them):

```bash
npx wrangler secret put PAYPAL_CLIENT_ID
npx wrangler secret put PAYPAL_CLIENT_SECRET
# Optional when using Gemini instead of the configured Workers AI binding:
npx wrangler secret put GEMINI_API_KEY
npm run dev
```

To deploy to your **own** Cloudflare account, create a Worker with Durable Objects and Workers AI enabled, provide your **own PayPal Sandbox Merchant App** Client ID and Secret as encrypted Worker secrets, then run `npm run deploy`. The already hosted live demo above is the easiest way to inspect the product.

## Verification and limitations

- **Real external integration:** The video records a successful PayPal Sandbox checkout with a displayed Order ID and Capture ID. The repository test suite instead uses **mock payment services** so it can run reproducibly without credentials.
- **Not a real-money or commercial payment processor.** There is no production fraud, tax, inventory, or merchant onboarding system.
- **No guarantees about model accuracy or latency.** The last recorded demo showed about 1.3 seconds for its server-side AI call; actual performance varies. The backend budget guardrail does not depend on model accuracy.
- **Test accounts:** Never share production credentials or publish test passwords, tokens, or API secrets.
- **Availability:** The live demo needs Cloudflare and PayPal Sandbox services to be available.

## Hackathon

Prepared for the **PayPal AI Hackathon, October–November 2026**. The PayPal + AI integration and working demonstration were developed during the event submission period.

This repository intentionally contains **only PayBoard**. It does not include proprietary SameBoard or WU5 research code.

## License

MIT — see [LICENSE](LICENSE). Third-party SDKs and dependencies retain their respective licenses.
