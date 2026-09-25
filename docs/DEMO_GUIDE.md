# Demonstration Guide

## Suggested seven-minute walkthrough

### 1. Start with the canvas

Show the ten Sticky Note sections and explain that they separate chat, agent tools, batch intake, state, policy, AI drafting, notifications, reporting, approval, and failures.

### 2. Show native integrations

Point out the AWS S3, Extract From File, Loop Over Items, Edit Fields, DynamoDB, Merge, If, Switch, Gmail, Aggregate, and Convert to File nodes. Mention that only four Code nodes remain for policy, AI screening, portfolio filtering, and redaction.

### 3. Run the fictional S3 feed

Use `samples/daily-invoice-aging.csv`. Show S3 download, CSV extraction, batching, invoice normalization, DynamoDB lookup, and merged state.

### 4. Explain deterministic policy

Open **Calculate Aging and Collection Rule**. Demonstrate one ordinary reminder, one high-value escalation, one disputed invoice, and one paid invoice. Emphasize that Bedrock does not choose the collection action.

### 5. Demonstrate AI drafting and fallback

Run an eligible reminder through Bedrock. Show **Parse and Screen AI Draft**, then pin an unsafe draft containing a placeholder or bank details to demonstrate the safe-template branch.

### 6. Show meaningful email nodes

Show the separate nodes for customer reminder, approval request, approved reminder, payment confirmation, manual review, run summary, and failure alert. Keep all recipients fictional during the demonstration.

### 7. Demonstrate approval

Use a high-value invoice to create a pending approval. Submit an incorrect phrase to show HTTP 409, then use a matching fictional pending record and an `example.com` recipient to show the approved path.

### 8. Close with evidence and operations

Show DynamoDB state and audit writes, the S3 delivery evidence, the XLSX run report, and the redacted Error Trigger path.

### 9. Optional chat demonstration

Ask for a portfolio total, then filter to invoices more than 60 days overdue and follow up with “Which one has the largest amount?” Show that the agent preserves context but refreshes facts through **Portfolio Search**. Ask for an exact invoice to show **Invoice State Lookup**, then request a reminder preview and show that the tool never sends email.

## Recording safety

- Use only the included fictional data.
- Keep the workflow inactive except during controlled manual tests.
- Hide credential panels, execution headers, and webhook URLs.
- Do not replace `example.com` recipients in a public recording.
- State that static validation passed but configured n8n runtime testing is environment-dependent.
