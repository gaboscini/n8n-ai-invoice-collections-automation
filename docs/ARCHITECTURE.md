# Architecture and Design Decisions

## Scope

The project demonstrates an AI-assisted invoice collections workflow built as one importable n8n canvas. It combines scheduled S3 ingestion, DynamoDB state, deterministic policy, Bedrock drafting, controlled Gmail notifications, approval handling, reporting, a conversational agent, and workflow-level failure operations.

It is not an accounting ledger, payment processor, customer master, or autonomous debt-collection system.

## Processing boundaries

1. **S3 is the batch-ingestion boundary.** The scheduled workflow downloads a fictional daily aging feed and extracts CSV records.
2. **DynamoDB is the state boundary.** Current invoice state, pending approvals, audit events, incidents, and compact agent session context use separate generic demonstration tables.
3. **Deterministic code owns financial policy.** Date arithmetic, invoice status, dispute status, amount thresholds, and aging determine the next action.
4. **Bedrock owns language generation only.** The model cannot select collection policy, authorize delivery, or create business facts.
5. **The content guard owns the AI trust boundary.** Unsafe drafts are discarded and replaced with a deterministic template.
6. **Gmail is the notification boundary.** Separate nodes make customer and internal notifications visible and independently configurable.
7. **The approval API owns high-risk delivery.** The send path independently verifies pending state, the exact phrase, and the recipient policy.
8. **S3 and DynamoDB retain evidence.** Delivery artifacts, run reports, state updates, and audit events are written after controlled actions.
9. **The Error Trigger owns operational failures.** Error text is redacted before incident storage or notification.

## Why native nodes are preferred

Native nodes expose system behavior on the canvas and make credential, retry, and execution boundaries visible. The workflow therefore uses AWS S3, AWS DynamoDB, Gmail, Extract From File, Loop Over Items, Edit Fields, Merge, If, Switch, Aggregate, Convert to File, Webhook, Respond to Webhook, and Error Trigger nodes directly.

Four Code nodes remain for logic that is clearer and safer as a bounded function: collection policy, AI-content screening, portfolio filtering and aggregation, and error redaction.

## Agent model

The conversational agent has three tools:

- portfolio search and aggregation from the current S3 feed;
- invoice state lookup;
- reminder preview.

The model chooses a relevant tool based on the meaning of the request rather than required keywords. Bounded chat memory and a compact DynamoDB session record may resolve follow-up references; neither can establish current financial facts. The S3 feed is authoritative for portfolio analysis, DynamoDB is authoritative for exact operational state, and the approval API remains authoritative for sending.

The scheduled drafting agent is separate. It receives a single policy-approved invoice and produces language only.

## Approval and idempotency

The demonstration stores approval state with an execution ID and exact phrase. The approval API checks `PENDING` state before delivery and writes a `USED` record afterward.

This demonstrates the control sequence but is not an atomic idempotency guarantee. Production implementation should use a DynamoDB conditional update or transactional write so only one concurrent request can change `PENDING` to `USED`.

## Failure model

The canvas includes an n8n Error Trigger path that truncates the error, redacts token-like strings, writes a generic incident, and emails only a bounded summary. In a production n8n deployment, this lane must be configured as a separate error workflow or duplicated into one, because an Error Trigger does not catch failures from its own containing workflow.

Retries are intentionally left to node-level n8n settings and infrastructure policy because the appropriate retry behavior differs by operation. For example, an S3 read can usually retry safely, while an email send requires provider reconciliation or idempotency before replay.

## Production hardening

Before production use, add:

- authenticated ingress and tenant authorization;
- least-privilege IAM roles scoped to specific tables, keys, models, and buckets;
- Secrets Manager or n8n-managed credentials;
- atomic approval consumption and delivery idempotency;
- suppression lists, consent rules, and bounce processing;
- encrypted storage, retention, backup, and deletion policies;
- queue-based throttling for larger volumes;
- CloudWatch metrics, alarms, traces, and provider reconciliation;
- legal review of collection rules and customer communication;
- integration tests against non-production AWS and email accounts.
