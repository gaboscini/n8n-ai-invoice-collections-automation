# Security Notes

## Public repository controls

- The workflow is inactive by default.
- No credential object, access key, API key, customer endpoint, or private infrastructure identifier is included.
- S3 buckets and DynamoDB tables use generic demonstration names.
- Static recipients use `example.com`; customer recipients are data-driven and the approval path restricts them to `example.com`.
- All sample companies, contacts, and invoices are fictional.
- Financial actions are selected by deterministic policy, not by the model.
- Bedrock receives minimized invoice fields and generates language only.
- AI output is screened and replaced when unsafe.
- High-risk reminders require an exact approval phrase.
- Errors are redacted before DynamoDB storage or Gmail notification.
- Conversation memory is bounded, durable session context stores only the latest exchange, and neither is treated as a source of financial truth.

## Credential guidance

Configure AWS and Gmail credentials only inside a non-production n8n environment. Use least-privilege AWS permissions and separate test email accounts. Never commit exported credential objects or screenshots containing credential names, webhook URLs, headers, or execution payloads.

## Important limitations

The approval update is not atomic in this public demonstration. Email delivery does not include suppression, bounce, or provider-reconciliation logic. Webhook ingress is not authenticated. These controls are required before production use.

## Reporting a secret

If a secret is disclosed, revoke or rotate it at the provider immediately. Removing it from the current file or rewriting Git history does not make the original credential safe again.
