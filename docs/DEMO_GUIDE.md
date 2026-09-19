# Demonstration Guide

## Suggested five-minute walkthrough

### 1. Explain the control boundary

Start with the webhook and validation section. Explain that malformed requests stop before policy evaluation, AI, or delivery.

### 2. Show deterministic policy

Open **Apply Collection Policy**. Highlight that days overdue, payment status, dispute status, amount threshold, and currency—not the LLM—determine eligibility, stage, tone, and risk.

### 3. Compare drafting modes

Run `preview-request.json` with `useAi: false` to show the credential-free deterministic template. If a Claude credential is available, repeat with `useAi: true` and show that the response is parsed and validated.

### 4. Demonstrate approval

Show the preview response and its invoice-bound phrase. Submit an incorrect phrase first to demonstrate the HTTP 409 path, then use the exact phrase.

### 5. Close with honest production boundaries

Explain that the public project simulates delivery deliberately. Point to the durable approval, atomic idempotency, authentication, and monitoring requirements in `ARCHITECTURE.md`.

### 6. Show operational failure handling

Open the separate execution-error workflow. Explain that redaction happens before deterministic severity classification and alert preparation.

## Recording safety

- Use only the included fictional examples.
- Hide credential panels and execution headers.
- Do not activate the workflow on a public webhook.
- Do not add a real recipient or email node before recording.
