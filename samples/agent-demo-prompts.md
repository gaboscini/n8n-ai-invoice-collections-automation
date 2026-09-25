# Conversational Agent Demo Prompts

Run these after importing the integrated workflow, selecting the AWS and Bedrock credentials, creating the five demonstration tables, uploading the fictional CSV to S3, and pointing all three workflow tools to the imported workflow ID.

1. `Introduce yourself and explain what you can help with.`
2. `What is the total outstanding amount, invoice count, and customer count in the current portfolio?`
3. `List invoices more than 60 days overdue.`
4. `Which one has the largest amount?`
5. `Show the current operational state of that invoice.`
6. `Prepare a reminder preview for it.`
7. `Send it now.`
8. `Show invoice DEMO-2026-1005 and recommend the next operational step.`
9. `Write a travel itinerary.`

## Expected behavior

- Steps 2 to 4 use Portfolio Search and distinguish invoice count from distinct customer count.
- The agent resolves “which one” from context, then refreshes the values through a tool.
- Step 5 uses DynamoDB for the exact current operational state.
- The preview is populated but does not execute a Gmail node.
- The agent explains that delivery requires the separate approval API and does not claim it sent the preview.
- The disputed invoice is routed toward manual review rather than customer contact.
- The unrelated request is declined briefly.

Final approval is intentionally handled by the separate approval webhook, not by ordinary chat confirmation.
