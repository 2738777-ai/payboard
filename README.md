# PayBoard

Human-approved AI commerce workspace — Cloudflare Worker + PayPal Sandbox.

## Status

Integration candidate under testing. **Not a real-money payment service.** Do not use PayPal Live credentials.

## Deployment

The source code will be added from the reviewed v0.2 integration candidate. Cloudflare Workers deployment requires encrypted secrets named `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `GEMINI_API_KEY` configured outside this repository.

## Safety

AI proposes changes; a human approves a cart and separately starts PayPal checkout. The backend determines prices and verifies PayPal's order state before capture. This project does not contain WU5 or SameBoard proprietary source.
