# Test Scenarios

## Automated static checks

Run:

```powershell
npm.cmd run build
npm.cmd test
```

The validator confirms:

- one valid integrated workflow export;
- 104 total nodes and 94 functional nodes;
- 10 concise, non-overlapping background notes;
- resolved connections and no functional-node overlaps;
- all four Code nodes compile;
- minimum native AWS, Gmail, Set, If, Switch, Merge, Loop, Extract, Aggregate, Convert, Webhook, and AI node counts;
- all three agent tools point to the visible self-workflow placeholder;
- generic S3 and DynamoDB resource names;
- no embedded credentials, likely secrets, proprietary identifiers, or live static recipients.

## Required runtime setup

1. Import the generated JSON into a non-production n8n workspace.
2. Keep the workflow inactive.
3. Configure non-production AWS and Gmail credentials.
4. Create the resources in `AWS_SETUP.md`.
5. Upload `samples/daily-invoice-aging.csv` to S3.
6. Point all three workflow-tool nodes to the imported workflow ID.
7. Execute each branch manually before enabling a trigger.

## Runtime scenario matrix

| Scenario | Input or condition | Expected evidence |
|---|---|---|
| S3 intake | Fictional CSV at the configured key | File downloaded, eight records extracted, batch begins |
| Ordinary reminder | Open invoice below USD 25,000 and due within seven days or overdue | Bedrock draft or safe fallback, customer Gmail node, state and audit writes |
| High-risk escalation | At least 60 days overdue or at least USD 25,000 | Approval queued; no customer email in scheduled path |
| Disputed invoice | `status=DISPUTED` | Manual-review Gmail node and audit write |
| Paid invoice | `status=PAID` and no prior confirmation | Payment-confirmation Gmail node and state write |
| No action | Current invoice outside reminder window | No customer email; no-action audit |
| Unsafe AI output | Pin output containing bank details or placeholders | Deterministic fallback template |
| Incorrect approval | Change one character in the phrase | HTTP 409 and no approved Gmail node |
| Blocked recipient | Pending approval with non-`example.com` recipient | HTTP 403 and no approved Gmail node |
| Correct approval | Exact pending phrase and fictional recipient | Approved Gmail node, audit record, approval marked used |
| Agent lookup | Ask for one exact seeded invoice | DynamoDB tool called; current state returned |
| Portfolio summary | Ask for totals or invoices over an aging threshold | Current S3 feed searched; counts, distinct customers, amounts, and bounded records returned |
| Contextual follow-up | After a filtered list, ask “Which one has the largest amount?” | Reference resolved; current facts refreshed through a tool rather than copied from memory |
| Reminder preview | Ask agent to prepare a reminder | Preview returned; no Gmail node executed |
| Workflow failure | Trigger a controlled node error | Redacted incident stored and operations alert prepared |

## Evidence checklist

Capture the following only after successful runtime tests:

- import screenshot with the full organized canvas;
- S3 input and report keys without account identifiers;
- DynamoDB example items using fictional data;
- execution output for each policy branch;
- AI guard fallback execution;
- approval rejection and success responses;
- Gmail test messages sent only to controlled test accounts;
- redacted incident record.

Runtime execution has not been performed as part of the repository's static build. Do not present static validation as evidence of deployed behavior.
