# AWS Demonstration Setup

This guide describes the generic resources referenced by the public workflow. It does not claim that infrastructure is deployed.

## S3 bucket

Create a non-production bucket named:

```text
invoice-collections-portfolio-demo
```

Expected keys:

```text
incoming/daily-invoice-aging.csv
evidence/<invoiceId>/<executionId>.xlsx
reports/<yyyy-mm-dd>/<executionId>.xlsx
```

Upload `samples/daily-invoice-aging.csv` to the incoming key before testing.

## DynamoDB tables

| Table | Partition key | Optional sort key |
|---|---|---|
| `invoice_collections_state_demo` | `invoiceId` (String) | None |
| `invoice_collections_approvals_demo` | `approvalId` (String) | None |
| `invoice_collections_audit_demo` | `invoiceId` (String) | `eventAt` (String) |
| `invoice_collections_incidents_demo` | `incidentId` (String) | None |
| `invoice_collections_agent_sessions_demo` | `sessionId` (String) | None |

Use on-demand capacity for a small demonstration. Enable point-in-time recovery if retaining the environment.

## Bedrock

The export references the global Anthropic Claude Sonnet 4.5 inference profile used by the current n8n Bedrock node configuration. Model availability and profile IDs vary by AWS account and region; select an available approved model after import if this profile is unavailable.

## IAM scope

The n8n AWS credential requires only the actions used by the demonstration:

- read the single incoming S3 object;
- write under `evidence/` and `reports/`;
- get and put items in the five demonstration tables;
- invoke the selected Bedrock model or inference profile.

Do not use administrator credentials. Resource ARNs and regional conditions should be narrowed to the test environment.

## n8n credentials

The public workflow contains no credential objects. After import:

1. create or select one non-production AWS credential;
2. assign it to all S3, DynamoDB, and Bedrock nodes;
3. create or select one non-production Gmail OAuth credential;
4. assign it to all Gmail nodes;
5. keep the workflow inactive until manual branch tests pass.
