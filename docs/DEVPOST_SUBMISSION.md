# Devpost submission — PayBoard (English copy)

**Project title:** PayBoard — Human-Controlled AI Commerce

**Tagline:** Let AI recommend. Let deterministic safeguards authorize the money.

**Project URL / live demo:** https://payboard.2738777.workers.dev/

**Source:** https://github.com/2738777-ai/payboard (must be made Public before submitting)

**Demo video:** https://youtube.com/shorts/Wc89S-c935A

## Inspiration

AI shopping agents can recommend convenient purchases, but their recommendations are probabilistic. An assistant can misunderstand a budget or suggest a combination that costs too much. A prompt telling the model to "never overspend" is not a payment guarantee. PayBoard separates AI recommendations from payment authorization.

## What it does

PayBoard accepts natural-language shopping requests, proposes a cart through a real AI model, and waits for human review. A deterministic state machine checks the cart against a server-side product catalog, user budget, actor permissions, and the approved checkout amount. Only then does PayBoard initiate a PayPal Sandbox checkout. The buyer approves the transaction in PayPal; the server verifies that approval and the locked amount before capturing it. The interface shows Order ID, Capture ID, and an auditable per-session event history.

## The demo moment

At 00:16–00:36, the AI suggests a $4.50 latte plus a $3.80 croissant ($8.30) against an $8 budget. The human accepts the suggestion, but PayBoard still disables checkout. The human replaces the latte with a $3.50 Americano, reducing the total to $7.30, and checkout becomes possible. This is a deliberate *demonstration of a real model error and the system's independent guardrail*—not a scripted or hardcoded result. The payment then completes in PayPal Sandbox with a real Sandbox order and capture receipt.

## How we built it

TypeScript on Cloudflare Workers, Durable Objects for per-visitor state, Cloudflare Workers AI (Gemma 4) for structured proposals, a deterministic payment state machine, PayPal JavaScript SDK for buyer approval, and the PayPal Orders v2 REST API for creation, verification, and capture. The backend computes prices and uses stable idempotency request IDs. GitHub Actions runs type checks, adversarial state-machine tests, and mocked end-to-end payment tests.

## Challenges and lessons

We had to distinguish AI reasoning from authority to spend. The first live AI calls also had unacceptable latency; disabling unnecessary extended reasoning improved the observed demo response to approximately 1.3 seconds. Separating proposal, human cart acceptance, checkout lock, buyer approval, and server capture produced clearer safety boundaries. The over-budget AI suggestion unexpectedly became our strongest proof that those boundaries are real.

## What is next

Extend the guarded state machine to real merchants and catalog integrations, add stronger reconciliation, accessible audit exports, and production-grade fraud controls. This submission remains strictly Sandbox-only.

## AI and PayPal usage

- **AI:** Cloudflare Workers AI / Gemma 4 proposes a cart and note; the system clearly labels non-model fallbacks.
- **PayPal:** JavaScript SDK, Orders v2 create/get/capture endpoints, Sandbox merchant and buyer accounts.
- **Other:** Cloudflare Workers, Durable Objects, TypeScript, GitHub Actions.

## Reviewers: how to try it

Open the live demo and submit an $8 coffee/breakfast request. Approve the cart, deliberately exceed the budget, and confirm that checkout stays blocked until corrected. Inspect the event history. To complete a test payment, use your own PayPal Developer *Personal Sandbox buyer* login; real-money credentials are never required.

**Disclosure:** Sandbox transactions only; not a live payments service. The event log is per-session and bounded, not an immutable blockchain ledger.
