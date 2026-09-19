# Test Scenarios

## Automated export checks

Run:

```powershell
npm run build
npm test
```

The validator checks that:

- both workflow JSON files parse;
- every Code node compiles;
- every connection resolves to a real node;
- required controls are present;
- the public export is inactive;
- no n8n credential objects or likely tokens are present;
- functional nodes do not overlap on the canvas.
- the main workflow contains eight documented process areas.

## Runtime scenarios

| Scenario | Sample | Expected result |
|---|---|---|
| Valid overdue preview | `preview-request.json` | `preview_ready`, draft returned, no delivery |
| Exact approved send | `approved-send-request.json` | `simulated_sent`, audit event returned |
| Invalid request | `invalid-request.json` | HTTP 400 before classification or AI |
| Paid invoice | `paid-invoice-request.json` | `no_action`, no draft or delivery |
| Incorrect approval phrase | Modify the approved sample | HTTP 409, no delivery |
| Analyst attempts send | Change approved sample role to `ar_analyst` | HTTP 403 before drafting or delivery |
| Recipient outside allow-list | Replace `example.com` with another domain | HTTP 403 after approval, no provider simulation |
| Disputed invoice | Set `disputeStatus` to `DISPUTED` | `no_action` |
| Claude unavailable | Set `useAi: true` without credentials | Safe fallback or controlled node error depending on n8n credential validation |
| Unsafe generated content | Pin Claude output containing bank details or placeholders | Safe template replacement |

## Manual review checklist

1. Import both workflows into a non-production n8n workspace.
2. Confirm both workflows are inactive.
3. Configure a Header Auth credential only if testing Claude.
4. Execute the preview request first.
5. Confirm no email node or external delivery node exists.
6. Test the exact approval phrase and one incorrect phrase.
7. Inspect the execution output for secrets or unnecessary personal data before recording screenshots.
8. Trigger a controlled failure and inspect the separate error workflow's redacted incident result.
