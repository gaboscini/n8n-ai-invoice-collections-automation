import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = resolve(projectRoot, "workflows");
const workflowPath = resolve(workflowDir, "ai-invoice-collections-automation.json");
let existingExport = null;
try {
  existingExport = JSON.parse(await readFile(workflowPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const nodes = [];
const connections = {};

const add = (id, name, type, typeVersion, position, parameters = {}, extra = {}) => {
  const item = { id, name, type, typeVersion, position, parameters, ...extra };
  nodes.push(item);
  return item;
};

const note = (id, name, position, width, height, color, title, description) =>
  add(id, name, "n8n-nodes-base.stickyNote", 1, position, {
    width, height, color, content: `## ${title}\n${description}`
  });

const setNode = (id, name, position, fields, includeOtherFields = false) => {
  const parameters = {
    assignments: {
      assignments: fields.map(([fieldName, value, type = "string"], index) => ({
        id: `${id}-field-${index + 1}`, name: fieldName, value, type
      }))
    },
    options: {}
  };
  if (includeOtherFields) parameters.includeOtherFields = true;
  return add(id, name, "n8n-nodes-base.set", 3.4, position, parameters);
};

const codeNode = (id, name, position, jsCode) =>
  add(id, name, "n8n-nodes-base.code", 2, position, { jsCode });

const ifNode = (id, name, position, leftValue, rightValue, operator) =>
  add(id, name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [{ id: `${id}-condition`, leftValue, rightValue, operator }],
      combinator: "and"
    },
    options: {}
  });

const switchNode = (id, name, position, leftValue, rules, fallbackName) =>
  add(id, name, "n8n-nodes-base.switch", 3.2, position, {
    rules: {
      values: rules.map(([rightValue, outputKey], index) => ({
        conditions: {
          options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
          conditions: [{
            id: `${id}-rule-${index + 1}`, leftValue, rightValue,
            operator: { type: "string", operation: "equals" }
          }],
          combinator: "and"
        },
        renameOutput: true,
        outputKey
      }))
    },
    options: { fallbackOutput: "extra", renameFallbackOutput: fallbackName }
  });

const dynamoGet = (id, name, position, tableName, keys) =>
  add(id, name, "n8n-nodes-base.awsDynamoDb", 1, position, {
    operation: "get",
    tableName,
    keysUi: { keyValues: keys.map(([key, value]) => ({ key, value })) },
    additionalFields: {}
  }, { alwaysOutputData: true });

const dynamoInsert = (id, name, position, tableName, fields) =>
  add(id, name, "n8n-nodes-base.awsDynamoDb", 1, position, {
    tableName,
    fieldsUi: { fieldValues: fields.map(([fieldId, fieldValue]) => ({ fieldId, fieldValue })) },
    additionalFields: {}
  });

const gmail = (id, name, position, sendTo, subject, message) =>
  add(id, name, "n8n-nodes-base.gmail", 2.2, position, {
    sendTo, subject, message,
    options: { appendAttribution: false }
  });

const respond = (id, name, position, responseCode, responseBody) =>
  add(id, name, "n8n-nodes-base.respondToWebhook", 1.4, position, {
    respondWith: "json", responseBody, options: { responseCode }
  });

const link = (source, target, sourceOutput = 0, targetInput = 0, type = "main") => {
  connections[source] ??= {};
  connections[source][type] ??= [];
  while (connections[source][type].length <= sourceOutput) connections[source][type].push([]);
  connections[source][type][sourceOutput].push({ node: target, type, index: targetInput });
};

// Notes are first so n8n renders them behind functional nodes.
note("note-chat", "Section - AI Operations Chat", [-1400, -1580], 2900, 570, 5,
  "AI Operations Chat",
  "Combines bounded chat memory with a durable session summary for reliable follow-ups. Current financial facts still come from governed tools, never from conversation history.");
note("note-tools", "Section - Governed Agent Tools", [-1400, -990], 2900, 750, 3,
  "Governed Agent Tools",
  "Provides portfolio search, exact state lookup, and controlled reminder previews. Read-only analysis is grounded in the current S3 feed, while actions remain approval-controlled.");
note("note-intake", "Section - Scheduled S3 Intake", [-1400, -240], 980, 500, 5,
  "Scheduled S3 Intake",
  "Loads the daily invoice aging feed from S3, extracts the CSV records, and processes invoices in bounded batches.");
note("note-enrichment", "Section - Invoice State Enrichment", [-400, -240], 1000, 540, 4,
  "Invoice State Enrichment",
  "Normalizes invoice fields, retrieves collection state from DynamoDB, and combines both sources before policy evaluation.");
note("note-decision", "Section - Collection Decision Engine", [620, -240], 800, 700, 2,
  "Collection Decision Engine",
  "Calculates aging and applies deterministic collection rules. Paid, disputed, reminder, escalation, and no-action outcomes are routed explicitly.");
note("note-ai", "Section - AI Drafting and Safety", [1440, -240], 1100, 620, 6,
  "AI Drafting & Safety",
  "Uses Amazon Bedrock to draft grounded customer communication. A deterministic guard validates the output and replaces unsafe content with an approved template.");
note("note-notifications", "Section - Notifications and Evidence", [2560, -240], 2000, 980, 3,
  "Notifications & Evidence",
  "Sends only meaningful customer or internal notifications, records state and audit events in DynamoDB, and stores delivery evidence in S3. High-risk reminders require approval.");
note("note-reporting", "Section - Run Reporting", [4580, -240], 1300, 500, 5,
  "Run Reporting",
  "Aggregates the completed batch, stores an XLSX run report in S3, and emails a concise operations summary.");
note("note-approval", "Section - Approval API", [2560, 800], 2740, 570, 4,
  "Approval API",
  "Validates one-time approval phrases and recipient policy before sending a queued reminder. Every accepted or rejected request returns a controlled webhook response.");
note("note-error", "Section - Error Handling", [-1400, 820], 1160, 390, 2,
  "Error Handling",
  "Redacts workflow failures, writes a structured incident record to DynamoDB, and alerts operations without exposing credentials or payload contents.");

// Conversational AI lane.
add("chat-trigger", "When Chat Message Received", "@n8n/n8n-nodes-langchain.chatTrigger", 1.3, [-1320, -1380], {
  options: { responseMode: "lastNode" }
});
setNode("normalize-chat", "Normalize Chat Request", [-1040, -1380], [
  ["chatInput", "={{ String($json.chatInput || '').trim().slice(0, 2000) }}"],
  ["sessionId", "={{ String($json.sessionId || $execution.id) }}"]
]);
dynamoGet("load-chat-context", "Load Saved Conversation Context", [-760, -1380], "invoice_collections_agent_sessions_demo", [
  ["sessionId", "={{ $('Normalize Chat Request').item.json.sessionId }}"]
]);
add("merge-chat-context", "Merge Current and Saved Context", "n8n-nodes-base.merge", 3.2, [-480, -1380], {
  mode: "combine", combineBy: "combineByPosition", options: {}
});
setNode("build-agent-prompt", "Build Grounded Agent Prompt", [-200, -1380], [
  ["chatInput", "={{ $('Normalize Chat Request').item.json.chatInput }}"],
  ["sessionId", "={{ $('Normalize Chat Request').item.json.sessionId }}"],
  ["savedContext", "={{ $json.lastAssistantResponse ? ('Previous user request: ' + String($json.lastUserMessage || '').slice(0, 1000) + '\\nPrevious assistant response: ' + String($json.lastAssistantResponse || '').slice(0, 2000)) : 'No durable context is available for this session.' }}"],
  ["agentPrompt", "={{ 'CURRENT USER REQUEST:\\n' + $('Normalize Chat Request').item.json.chatInput + '\\n\\nDURABLE SESSION REFERENCE (not authoritative financial data):\\n' + ($json.lastAssistantResponse ? ('Previous user request: ' + String($json.lastUserMessage || '').slice(0, 1000) + '\\nPrevious assistant response: ' + String($json.lastAssistantResponse || '').slice(0, 2000)) : 'No prior durable context.') }}"]
]);
add("operations-agent", "Invoice Collections Agent", "@n8n/n8n-nodes-langchain.agent", 2, [80, -1380], {
  promptType: "define",
  text: "={{ $json.agentPrompt }}",
  options: {
    systemMessage: `You are an enterprise B2B invoice-collections operations assistant for a fictional portfolio demonstration.

UNDERSTAND THE REQUEST
- Interpret the user's full meaning, not isolated keywords or fixed phrases.
- Resolve follow-ups such as "that invoice", "the largest one", "those overdue accounts", and "prepare it" from the conversation and durable session reference.
- If more than one interpretation would materially change the result, ask one concise clarification question. Otherwise proceed with the most reasonable AR interpretation.
- Answer only Accounts Receivable, invoice, customer-balance, collection, payment-status, aging, reporting, and reminder questions. Decline unrelated requests briefly.

GROUNDING AND TOOL CHOICE
- Use Portfolio Search for totals, lists, comparisons, customer or owner searches, status filters, aging filters, and portfolio summaries.
- Use Invoice State Lookup for the current operational state of one exact invoice.
- Use Reminder Preview only when the user wants an official reminder preview for one exact invoice.
- Tool results are authoritative for current facts. Conversation memory and durable context may resolve references, but they are never evidence for amounts, dates, status, recipients, eligibility, or action completion.
- If a tool returns no result, say that clearly. Never fill gaps from assumptions.
- Distinguish invoice count from distinct customer count. Treat PAID invoices as not outstanding. Do not recommend collection action for DISPUTED invoices.

SAFETY AND ACTIONS
- Never invent or alter invoice IDs, customer names, amounts, dates, recipients, payment status, bank details, fees, penalties, legal claims, approval phrases, or execution results.
- Read-only retrieval and analysis may proceed automatically.
- A reminder preview does not send email. Actual delivery is handled only by the separate approval API after independent validation; you cannot send email and must never claim that you did.
- If asked to send, explain the approval requirement and offer or prepare the governed preview when an exact eligible invoice is known.

RESPONSE QUALITY
- Lead with the direct answer, then the minimum supporting detail.
- Use concise business language. Use Markdown tables for multi-record results.
- Label recommendations as recommendations and separate them from confirmed tool facts.`
  }
});
setNode("format-chat", "Format Agent Response", [360, -1380], [
  ["response", "={{ $json.output || $json.text || 'No response was generated.' }}"],
  ["sessionId", "={{ $('Normalize Chat Request').item.json.sessionId }}"]
]);
dynamoInsert("save-chat-context", "Save Conversation Context", [640, -1380], "invoice_collections_agent_sessions_demo", [
  ["sessionId", "={{ $('Normalize Chat Request').item.json.sessionId }}"],
  ["lastUserMessage", "={{ $('Normalize Chat Request').item.json.chatInput }}"],
  ["lastAssistantResponse", "={{ String($json.response || '').slice(0, 4000) }}"],
  ["updatedAt", "={{ $now.toISO() }}"]
]);
setNode("return-chat-response", "Return Agent Response", [920, -1380], [
  ["response", "={{ $('Format Agent Response').item.json.response }}"],
  ["sessionId", "={{ $('Normalize Chat Request').item.json.sessionId }}"]
]);
add("agent-bedrock", "Agent Bedrock Chat Model", "@n8n/n8n-nodes-langchain.lmChatAwsBedrock", 1.1, [80, -1130], {
  modelSource: "inferenceProfile",
  model: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  options: { temperature: 0.2 }
});
add("agent-memory", "Bounded Conversation Memory", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.3, [360, -1130], {
  sessionKey: "={{ $('Normalize Chat Request').item.json.sessionId }}",
  contextWindowLength: 12
});
add("portfolio-tool", "Portfolio Search", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [640, -1130], {
  description: "Search and summarize the current invoice portfolio. Use for totals, lists, aging filters, customer or owner searches, comparisons, and follow-up references to sets of invoices.",
  workflowId: { __rl: true, value: "REPLACE_WITH_THIS_WORKFLOW_ID", mode: "id", cachedResultName: "AI Invoice Collections Automation - Integrated Agent" },
  workflowInputs: {
    mappingMode: "defineBelow",
    value: {
      operation: "search_portfolio",
      invoice_id: "={{ $fromAI('invoice_id', 'Optional exact or partial invoice ID', 'string', '') }}",
      customer: "={{ $fromAI('customer', 'Optional customer name search', 'string', '') }}",
      status: "={{ $fromAI('status', 'Optional invoice status such as OPEN, OVERDUE, PAID, or DISPUTED', 'string', '') }}",
      collection_action: "={{ $fromAI('collection_action', 'Optional collection action filter', 'string', '') }}",
      min_days_overdue: "={{ $fromAI('min_days_overdue', 'Optional minimum days overdue', 'number', -99999) }}",
      max_days_overdue: "={{ $fromAI('max_days_overdue', 'Optional maximum days overdue', 'number', 99999) }}",
      account_owner: "={{ $fromAI('account_owner', 'Optional account owner name search', 'string', '') }}",
      limit: "={{ $fromAI('limit', 'Maximum records to return from 1 to 50', 'number', 20) }}"
    },
    matchingColumns: [],
    schema: [
      { id: "operation", displayName: "operation", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "invoice_id", displayName: "invoice_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "customer", displayName: "customer", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "status", displayName: "status", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "collection_action", displayName: "collection_action", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "min_days_overdue", displayName: "min_days_overdue", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "number", removed: false },
      { id: "max_days_overdue", displayName: "max_days_overdue", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "number", removed: false },
      { id: "account_owner", displayName: "account_owner", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "limit", displayName: "limit", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "number", removed: false }
    ],
    attemptToConvertTypes: false,
    convertFieldsToString: false
  }
});
add("lookup-tool", "Invoice State Lookup", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [920, -1130], {
  description: "Retrieve the current state for one exact invoice ID from the portfolio state store.",
  workflowId: { __rl: true, value: "REPLACE_WITH_THIS_WORKFLOW_ID", mode: "id", cachedResultName: "AI Invoice Collections Automation - Integrated Agent" },
  workflowInputs: {
    mappingMode: "defineBelow",
    value: { operation: "lookup_invoice", invoice_id: "={{ $fromAI('invoice_id', 'Exact invoice ID', 'string') }}" },
    matchingColumns: [],
    schema: [
      { id: "operation", displayName: "operation", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "invoice_id", displayName: "invoice_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false }
    ],
    attemptToConvertTypes: false,
    convertFieldsToString: false
  }
});
add("preview-tool", "Reminder Preview", "@n8n/n8n-nodes-langchain.toolWorkflow", 2.2, [1200, -1130], {
  description: "Prepare a controlled preview for one exact invoice ID. This tool never sends email.",
  workflowId: { __rl: true, value: "REPLACE_WITH_THIS_WORKFLOW_ID", mode: "id", cachedResultName: "AI Invoice Collections Automation - Integrated Agent" },
  workflowInputs: {
    mappingMode: "defineBelow",
    value: { operation: "preview_reminder", invoice_id: "={{ $fromAI('invoice_id', 'Exact invoice ID', 'string') }}" },
    matchingColumns: [],
    schema: [
      { id: "operation", displayName: "operation", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false },
      { id: "invoice_id", displayName: "invoice_id", required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: "string", removed: false }
    ],
    attemptToConvertTypes: false,
    convertFieldsToString: false
  }
});

// Internal tools lane.
add("tool-trigger", "When Called as Agent Tool", "n8n-nodes-base.executeWorkflowTrigger", 1.1, [-1320, -820], {
  workflowInputs: { values: [
    { name: "operation" }, { name: "invoice_id" },
    { name: "customer" }, { name: "status" },
    { name: "collection_action" }, { name: "min_days_overdue", type: "number" },
    { name: "max_days_overdue", type: "number" }, { name: "account_owner" },
    { name: "limit", type: "number" }
  ] }
});
switchNode("tool-router", "Route Agent Tool Operation", [-1040, -820], "={{ $json.operation }}", [
  ["search_portfolio", "Portfolio search"],
  ["lookup_invoice", "Invoice lookup"],
  ["preview_reminder", "Reminder preview"]
], "Unsupported operation");
add("tool-download-portfolio", "Download Agent Portfolio Feed", "n8n-nodes-base.awsS3", 2, [-760, -900], {
  bucketName: "invoice-collections-portfolio-demo",
  fileKey: "incoming/daily-invoice-aging.csv",
  binaryPropertyName: "=data"
});
add("tool-extract-portfolio", "Extract Agent Portfolio CSV", "n8n-nodes-base.extractFromFile", 1, [-480, -900], {
  binaryPropertyName: "=data", options: {}
});
codeNode("tool-filter-portfolio", "Filter and Summarize Portfolio", [-200, -900], `const request = $('When Called as Agent Tool').item.json;
const text = value => String(value ?? '').trim();
const upper = value => text(value).toUpperCase();
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const minDays = numberOr(request.min_days_overdue, -99999);
const maxDays = numberOr(request.max_days_overdue, 99999);
const limit = Math.max(1, Math.min(50, Math.trunc(numberOr(request.limit, 20))));
const today = new Date();
const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
const rows = $input.all().map(item => {
  const row = item.json;
  const dueDate = text(row.dueDate || row['Due Date']);
  const due = new Date(dueDate + 'T00:00:00Z');
  const daysOverdue = Number.isFinite(due.getTime()) ? Math.floor((todayUtc - due.getTime()) / 86400000) : null;
  const status = upper(row.status || row.Status || 'OPEN');
  const amountUsd = numberOr(row.amountUsd || row['Amount USD'], 0);
  const disputeStatus = upper(row.disputeStatus || row.Dispute || 'NONE');
  let collectionAction = 'NO_ACTION';
  if (status === 'PAID') collectionAction = 'PAYMENT_CONFIRMATION';
  else if (disputeStatus !== 'NONE' || status === 'DISPUTED') collectionAction = 'MANUAL_REVIEW';
  else if (['OPEN', 'OVERDUE'].includes(status) && daysOverdue !== null && (daysOverdue >= 60 || amountUsd >= 25000)) collectionAction = 'INTERNAL_ESCALATION';
  else if (['OPEN', 'OVERDUE'].includes(status) && daysOverdue !== null && daysOverdue >= -7) collectionAction = 'CUSTOMER_REMINDER';
  return {
    invoiceId: upper(row.invoiceId || row['Invoice ID']),
    customerName: text(row.customerName || row.Customer),
    amountUsd,
    dueDate,
    daysOverdue,
    status,
    disputeStatus,
    accountOwner: text(row.accountOwner || row.Owner),
    collectionAction
  };
}).filter(row => row.invoiceId);
const invoiceFilter = upper(request.invoice_id);
const customerFilter = upper(request.customer);
const statusFilter = upper(request.status);
const actionFilter = upper(request.collection_action);
const ownerFilter = upper(request.account_owner);
const matches = rows.filter(row =>
  (!invoiceFilter || row.invoiceId.includes(invoiceFilter)) &&
  (!customerFilter || upper(row.customerName).includes(customerFilter)) &&
  (!statusFilter || row.status === statusFilter) &&
  (!actionFilter || row.collectionAction === actionFilter) &&
  (!ownerFilter || upper(row.accountOwner).includes(ownerFilter)) &&
  (row.daysOverdue === null || (row.daysOverdue >= minDays && row.daysOverdue <= maxDays))
);
const outstanding = matches.filter(row => row.status !== 'PAID');
return [{ json: {
  ok: true,
  totalMatchingInvoices: matches.length,
  distinctCustomerCount: new Set(matches.map(row => upper(row.customerName))).size,
  totalAmountUsd: matches.reduce((sum, row) => sum + row.amountUsd, 0),
  totalOutstandingUsd: outstanding.reduce((sum, row) => sum + row.amountUsd, 0),
  returnedCount: Math.min(matches.length, limit),
  hasMore: matches.length > limit,
  appliedFilters: { invoiceId: invoiceFilter, customer: text(request.customer), status: statusFilter, collectionAction: actionFilter, minDaysOverdue: minDays, maxDaysOverdue: maxDays, accountOwner: text(request.account_owner) },
  records: matches.slice(0, limit)
} }];`);
setNode("tool-return-portfolio", "Return Portfolio Search Result", [80, -900], [
  ["ok", "={{ $json.ok }}", "boolean"],
  ["totalMatchingInvoices", "={{ $json.totalMatchingInvoices }}", "number"],
  ["distinctCustomerCount", "={{ $json.distinctCustomerCount }}", "number"],
  ["totalAmountUsd", "={{ $json.totalAmountUsd }}", "number"],
  ["totalOutstandingUsd", "={{ $json.totalOutstandingUsd }}", "number"],
  ["returnedCount", "={{ $json.returnedCount }}", "number"],
  ["hasMore", "={{ $json.hasMore }}", "boolean"],
  ["appliedFilters", "={{ $json.appliedFilters }}", "object"],
  ["records", "={{ $json.records }}", "array"]
]);
dynamoGet("tool-lookup-state", "Get Invoice State for Agent", [-760, -680], "invoice_collections_state_demo", [
  ["invoiceId", "={{ String($json.invoice_id || '').trim().toUpperCase() }}"]
]);
setNode("tool-format-state", "Format Invoice State Result", [-480, -680], [
  ["ok", "={{ Boolean($json.invoiceId) }}", "boolean"],
  ["invoiceId", "={{ $json.invoiceId || $('When Called as Agent Tool').item.json.invoice_id }}"],
  ["customerName", "={{ $json.customerName || '' }}"],
  ["amountUsd", "={{ Number($json.amountUsd || 0) }}", "number"],
  ["dueDate", "={{ $json.dueDate || '' }}"],
  ["status", "={{ $json.status || 'NOT_FOUND' }}"],
  ["collectionAction", "={{ $json.collectionAction || '' }}"]
]);
dynamoGet("tool-get-preview", "Get Reminder State for Agent", [-760, -460], "invoice_collections_state_demo", [
  ["invoiceId", "={{ String($json.invoice_id || '').trim().toUpperCase() }}"]
]);
ifNode("tool-preview-eligible", "Reminder Preview Eligible?", [-480, -460],
  "={{ ['OPEN','OVERDUE'].includes(String($json.status || '').toUpperCase()) }}", true,
  { type: "boolean", operation: "equals", singleValue: true });
setNode("tool-build-preview", "Build Agent Reminder Preview", [-200, -520], [
  ["ok", true, "boolean"], ["status", "preview_ready"], ["invoiceId", "={{ $json.invoiceId }}"],
  ["subject", "={{ 'Payment reminder - invoice ' + $json.invoiceId }}"],
  ["message", "={{ 'A controlled reminder preview is available for ' + ($json.customerName || 'the customer') + '. Use the approval API to authorize delivery.' }}"],
  ["sent", false, "boolean"]
]);
setNode("tool-preview-blocked", "Return Ineligible Preview Result", [-200, -340], [
  ["ok", false, "boolean"], ["status", "not_eligible"],
  ["message", "This invoice is not eligible for a reminder preview."], ["sent", false, "boolean"]
]);
setNode("tool-unsupported", "Return Unsupported Tool Operation", [80, -340], [
  ["ok", false, "boolean"], ["status", "unsupported_tool_operation"],
  ["message", "The requested internal tool operation is not supported."]
]);

// Scheduled invoice pipeline.
add("daily-schedule", "Daily Collections Schedule", "n8n-nodes-base.scheduleTrigger", 1.2, [-1320, -60], {
  rule: { interval: [{ triggerAtHour: 8 }] }
});
add("download-feed", "Download Invoice Aging Feed", "n8n-nodes-base.awsS3", 2, [-1080, -60], {
  bucketName: "invoice-collections-portfolio-demo",
  fileKey: "incoming/daily-invoice-aging.csv",
  binaryPropertyName: "=data"
});
add("extract-feed", "Extract Invoice CSV", "n8n-nodes-base.extractFromFile", 1, [-840, -60], {
  binaryPropertyName: "=data", options: {}
});
add("invoice-loop", "Loop Over Invoices", "n8n-nodes-base.splitInBatches", 3, [-600, -60], {
  batchSize: 25, options: {}
});
setNode("normalize-invoice", "Normalize Invoice Record", [-320, -60], [
  ["invoiceId", "={{ String($json.invoiceId || $json['Invoice ID'] || '').trim().toUpperCase() }}"],
  ["customerName", "={{ String($json.customerName || $json.Customer || '').trim().slice(0, 160) }}"],
  ["customerEmail", "={{ String($json.customerEmail || $json.Email || '').trim().toLowerCase() }}"],
  ["amountUsd", "={{ Number($json.amountUsd || $json['Amount USD'] || 0) }}", "number"],
  ["dueDate", "={{ String($json.dueDate || $json['Due Date'] || '').slice(0, 10) }}"],
  ["status", "={{ String($json.status || $json.Status || 'OPEN').trim().toUpperCase() }}"],
  ["disputeStatus", "={{ String($json.disputeStatus || $json.Dispute || 'NONE').trim().toUpperCase() }}"],
  ["accountOwner", "={{ String($json.accountOwner || $json.Owner || '').trim().slice(0, 120) }}"],
  ["source", "daily_s3_feed"]
]);
ifNode("invoice-valid", "Invoice Record Valid?", [-80, -60],
  "={{ Boolean($json.invoiceId && $json.customerName && $json.dueDate && Number.isFinite($json.amountUsd) && $json.amountUsd >= 0) }}",
  true, { type: "boolean", operation: "equals", singleValue: true });
dynamoGet("get-state", "Get Existing Collection State", [160, -60], "invoice_collections_state_demo", [
  ["invoiceId", "={{ $('Normalize Invoice Record').item.json.invoiceId }}"]
]);
add("merge-state", "Merge Invoice and State", "n8n-nodes-base.merge", 3.2, [400, -60], {
  mode: "combine", combineBy: "combineByPosition", options: {}
});
setNode("invalid-invoice", "Build Data Quality Alert", [-80, 180], [
  ["invoiceId", "={{ $json.invoiceId || 'MISSING' }}"], ["customerName", "={{ $json.customerName || 'MISSING' }}"],
  ["eventType", "DATA_QUALITY_REVIEW"], ["eventAt", "={{ $now.toISO() }}"],
  ["subject", "={{ 'Invoice feed validation failed - ' + ($json.invoiceId || 'missing invoice ID') }}"],
  ["emailBody", "={{ '<p>An invoice record failed validation and was not processed.</p><p><strong>Invoice:</strong> ' + ($json.invoiceId || 'missing') + '</p><p><strong>Customer:</strong> ' + ($json.customerName || 'missing') + '</p>' }}"]
]);
gmail("data-quality-email", "Send Data Quality Alert", [160, 180], "collections-ops@example.com",
  "={{ $json.subject }}", "={{ $json.emailBody }}");
dynamoInsert("data-quality-audit", "Write Data Quality Audit", [400, 180], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Build Data Quality Alert').item.json.invoiceId }}"],
  ["eventAt", "={{ $('Build Data Quality Alert').item.json.eventAt }}"], ["eventType", "DATA_QUALITY_REVIEW"],
  ["details", "Invoice record failed required-field validation"]
]);
codeNode("calculate-policy", "Calculate Aging and Collection Rule", [660, -60], `const invoice = $json;
const due = new Date(String(invoice.dueDate || '') + 'T00:00:00Z');
const now = new Date();
const validDueDate = Number.isFinite(due.getTime());
const daysOverdue = validDueDate ? Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - due.getTime()) / 86400000) : null;
const status = String(invoice.status || 'OPEN').toUpperCase();
const dispute = String(invoice.disputeStatus || 'NONE').toUpperCase();
let collectionAction = 'no_action';
if (status === 'PAID' && invoice.paymentConfirmationSent !== true) collectionAction = 'payment_confirmation';
else if (dispute !== 'NONE' || status === 'DISPUTED') collectionAction = 'manual_review';
else if (['OPEN', 'OVERDUE'].includes(status) && daysOverdue !== null && (daysOverdue >= 60 || Number(invoice.amountUsd || 0) >= 25000)) collectionAction = 'internal_escalation';
else if (['OPEN', 'OVERDUE'].includes(status) && daysOverdue !== null && daysOverdue >= -7) collectionAction = 'customer_reminder';
const actionRequired = collectionAction !== 'no_action';
const requiresApproval = collectionAction === 'internal_escalation' || Number(invoice.amountUsd || 0) >= 25000;
return { json: { ...invoice, daysOverdue, collectionAction, actionRequired, requiresApproval, policyEvaluatedAt: new Date().toISOString() } };`);
ifNode("action-required", "Collection Action Required?", [920, -60],
  "={{ $json.actionRequired }}", true, { type: "boolean", operation: "equals", singleValue: true });
setNode("no-action", "Build No Action Result", [920, 180], [
  ["invoiceId", "={{ $('Calculate Aging and Collection Rule').item.json.invoiceId }}"],
  ["eventType", "NO_ACTION"],
  ["reason", "={{ 'No collection action required for status ' + $('Calculate Aging and Collection Rule').item.json.status }}"],
  ["eventAt", "={{ $now.toISO() }}"]
]);
dynamoInsert("no-action-audit", "Write No Action Audit", [1180, 180], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $json.invoiceId }}"], ["eventAt", "={{ $json.eventAt }}"],
  ["eventType", "={{ $json.eventType }}"], ["details", "={{ $json.reason }}"]
]);
switchNode("action-router", "Route Collection Action", [1180, -60], "={{ $json.collectionAction }}", [
  ["customer_reminder", "Customer reminder"],
  ["internal_escalation", "Escalation draft"],
  ["payment_confirmation", "Payment confirmation"]
], "Manual review");

// AI drafting and notification branches.
add("draft-agent", "Bedrock Reminder Drafting Agent", "@n8n/n8n-nodes-langchain.agent", 2, [1520, -60], {
  promptType: "define",
  text: "={{ `Draft a concise B2B payment reminder using only these fields: invoice ${$json.invoiceId}, customer ${$json.customerName}, amount USD ${$json.amountUsd}, due date ${$json.dueDate}, days overdue ${$json.daysOverdue}, action ${$json.collectionAction}. Return a subject line followed by the email body. Do not add payment instructions, penalties, legal claims, or facts not provided.` }}",
  options: {
    systemMessage: "You draft factual, professional invoice-collection emails from supplied fields only. Never invent bank details, legal consequences, fees, dates, amounts, contacts, or promises. Do not use placeholders."
  }
});
add("draft-bedrock", "Drafting Bedrock Chat Model", "@n8n/n8n-nodes-langchain.lmChatAwsBedrock", 1.1, [1520, 180], {
  modelSource: "inferenceProfile",
  model: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
  options: { temperature: 0.1 }
});
codeNode("screen-draft", "Parse and Screen AI Draft", [1780, -60], `const source = $('Calculate Aging and Collection Rule').item.json;
const text = String($json.output || '').trim();
const lines = text.split(/\\r?\\n/).filter(Boolean);
const rawSubject = (lines.shift() || '').replace(/^subject\\s*:\\s*/i, '').trim();
const body = lines.join('\\n').trim();
const forbidden = /(bank account|routing number|swift|iban|late fee|penalty|legal action|\\[[^\\]]+\\])/i;
const draftSafe = rawSubject.length >= 8 && rawSubject.length <= 160 && body.length >= 40 && body.length <= 5000 && !forbidden.test(text);
return { json: { ...source, generatedSubject: rawSubject, generatedBody: body, draftSafe, draftSource: 'amazon_bedrock' } };`);
ifNode("draft-safe", "AI Draft Safe?", [2040, -60],
  "={{ $json.draftSafe }}", true, { type: "boolean", operation: "equals", singleValue: true });
setNode("safe-template", "Apply Safe Reminder Template", [2040, 180], [
  ["invoiceId", "={{ $('Calculate Aging and Collection Rule').item.json.invoiceId }}"],
  ["customerName", "={{ $('Calculate Aging and Collection Rule').item.json.customerName }}"],
  ["customerEmail", "={{ $('Calculate Aging and Collection Rule').item.json.customerEmail }}"],
  ["amountUsd", "={{ $('Calculate Aging and Collection Rule').item.json.amountUsd }}", "number"],
  ["dueDate", "={{ $('Calculate Aging and Collection Rule').item.json.dueDate }}"],
  ["daysOverdue", "={{ $('Calculate Aging and Collection Rule').item.json.daysOverdue }}", "number"],
  ["collectionAction", "={{ $('Calculate Aging and Collection Rule').item.json.collectionAction }}"],
  ["requiresApproval", "={{ $('Calculate Aging and Collection Rule').item.json.requiresApproval }}", "boolean"],
  ["generatedSubject", "={{ 'Payment reminder - invoice ' + $('Calculate Aging and Collection Rule').item.json.invoiceId }}"],
  ["generatedBody", "={{ 'Dear ' + $('Calculate Aging and Collection Rule').item.json.customerName + ',<br><br>This is a reminder that invoice <strong>' + $('Calculate Aging and Collection Rule').item.json.invoiceId + '</strong> for USD ' + Number($('Calculate Aging and Collection Rule').item.json.amountUsd).toFixed(2) + ' was due on ' + $('Calculate Aging and Collection Rule').item.json.dueDate + '. Please let us know if payment has already been arranged.<br><br>Regards,<br>Accounts Receivable' }}"],
  ["draftSource", "deterministic_safe_template"]
]);
setNode("prepare-email", "Prepare Customer Email", [2300, -60], [
  ["invoiceId", "={{ $json.invoiceId }}"], ["customerName", "={{ $json.customerName }}"],
  ["customerEmail", "={{ $json.customerEmail }}"], ["amountUsd", "={{ $json.amountUsd }}", "number"],
  ["collectionAction", "={{ $json.collectionAction }}"], ["requiresApproval", "={{ $json.requiresApproval }}", "boolean"],
  ["subject", "={{ $json.generatedSubject }}"], ["emailBody", "={{ $json.generatedBody }}"],
  ["draftSource", "={{ $json.draftSource }}"],
  ["approvalPhrase", "={{ 'APPROVE COLLECTION ' + $json.invoiceId + ' ' + $execution.id }}"]
]);
ifNode("approval-required", "Human Approval Required?", [2640, -60],
  "={{ $json.requiresApproval }}", true, { type: "boolean", operation: "equals", singleValue: true });
dynamoInsert("queue-approval", "Queue Pending Approval", [2900, -180], "invoice_collections_approvals_demo", [
  ["approvalId", "={{ $execution.id }}"], ["invoiceId", "={{ $json.invoiceId }}"],
  ["customerName", "={{ $json.customerName }}"], ["customerEmail", "={{ $json.customerEmail }}"],
  ["subject", "={{ $json.subject }}"], ["emailBody", "={{ $json.emailBody }}"],
  ["approvalPhrase", "={{ $json.approvalPhrase }}"], ["status", "PENDING"], ["createdAt", "={{ $now.toISO() }}"]
]);
gmail("approval-email", "Send Approval Request", [3160, -180], "collections-review@example.com",
  "={{ 'Approval required: ' + $('Prepare Customer Email').item.json.invoiceId }}",
  "={{ '<p>A collection reminder requires review.</p><p><strong>Invoice:</strong> ' + $('Prepare Customer Email').item.json.invoiceId + '</p><p><strong>Customer:</strong> ' + $('Prepare Customer Email').item.json.customerName + '</p><p>Approval phrase: <code>' + $('Prepare Customer Email').item.json.approvalPhrase + '</code></p>' }}");
dynamoInsert("approval-audit", "Write Approval Queue Audit", [3420, -180], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Prepare Customer Email').item.json.invoiceId }}"], ["eventAt", "={{ $now.toISO() }}"],
  ["eventType", "APPROVAL_QUEUED"], ["details", "Reminder queued for human approval"]
]);
ifNode("scheduled-recipient", "Scheduled Recipient Allowed?", [2820, 100],
  "={{ /^[^@\\s]+@example\\.com$/i.test(String($json.customerEmail || '')) }}", true,
  { type: "boolean", operation: "equals", singleValue: true });
gmail("send-reminder", "Send Customer Payment Reminder", [3060, 40], "={{ $json.customerEmail }}",
  "={{ $json.subject }}", "={{ $json.emailBody }}");
setNode("delivery-record", "Build Reminder Delivery Record", [3320, 40], [
  ["invoiceId", "={{ $('Prepare Customer Email').item.json.invoiceId }}"],
  ["customer", "={{ $('Prepare Customer Email').item.json.customerName }}"],
  ["recipient", "={{ $('Prepare Customer Email').item.json.customerEmail }}"],
  ["subject", "={{ $('Prepare Customer Email').item.json.subject }}"],
  ["action", "={{ $('Prepare Customer Email').item.json.collectionAction }}"],
  ["draftSource", "={{ $('Prepare Customer Email').item.json.draftSource }}"],
  ["sentAt", "={{ $now.toISO() }}"]
]);
add("delivery-file", "Convert Delivery Evidence to XLSX", "n8n-nodes-base.convertToFile", 1.1, [3580, 40], {
  operation: "xlsx", options: { fileName: "invoice-delivery-evidence.xlsx", headerRow: true, sheetName: "Delivery Evidence" }
});
add("store-delivery", "Store Delivery Evidence in S3", "n8n-nodes-base.awsS3", 2, [3840, 40], {
  operation: "upload", bucketName: "invoice-collections-portfolio-demo",
  fileName: "={{ 'evidence/' + $('Prepare Customer Email').item.json.invoiceId + '/' + $execution.id + '.xlsx' }}",
  additionalFields: {}, tagsUi: { tagsValues: [] }
});
dynamoInsert("reminder-state", "Record Reminder State", [4100, 40], "invoice_collections_state_demo", [
  ["invoiceId", "={{ $('Prepare Customer Email').item.json.invoiceId }}"],
  ["customerName", "={{ $('Prepare Customer Email').item.json.customerName }}"],
  ["status", "REMINDER_SENT"], ["collectionAction", "={{ $('Prepare Customer Email').item.json.collectionAction }}"],
  ["lastContactAt", "={{ $now.toISO() }}"], ["executionId", "={{ $execution.id }}"]
]);
dynamoInsert("reminder-audit", "Write Reminder Audit", [4360, 40], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Prepare Customer Email').item.json.invoiceId }}"], ["eventAt", "={{ $now.toISO() }}"],
  ["eventType", "REMINDER_SENT"], ["details", "={{ 'Draft source: ' + $('Prepare Customer Email').item.json.draftSource }}"]
]);

setNode("payment-confirmation", "Build Payment Confirmation", [2640, 300], [
  ["invoiceId", "={{ $json.invoiceId }}"], ["customerName", "={{ $json.customerName }}"],
  ["customerEmail", "={{ $json.customerEmail }}"],
  ["subject", "={{ 'Payment received - invoice ' + $json.invoiceId }}"],
  ["emailBody", "={{ 'Dear ' + $json.customerName + ',<br><br>Thank you. We have recorded payment for invoice <strong>' + $json.invoiceId + '</strong>.<br><br>Regards,<br>Accounts Receivable' }}"]
]);
ifNode("payment-recipient", "Payment Recipient Allowed?", [2880, 300],
  "={{ /^[^@\\s]+@example\\.com$/i.test(String($json.customerEmail || '')) }}", true,
  { type: "boolean", operation: "equals", singleValue: true });
gmail("send-confirmation", "Send Payment Confirmation", [3160, 300], "={{ $json.customerEmail }}",
  "={{ $json.subject }}", "={{ $json.emailBody }}");
dynamoInsert("payment-state", "Record Payment Confirmation", [3440, 300], "invoice_collections_state_demo", [
  ["invoiceId", "={{ $('Build Payment Confirmation').item.json.invoiceId }}"], ["status", "PAID"],
  ["paymentConfirmationSent", "true"], ["lastContactAt", "={{ $now.toISO() }}"]
]);
dynamoInsert("payment-audit", "Write Payment Confirmation Audit", [3720, 300], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Build Payment Confirmation').item.json.invoiceId }}"], ["eventAt", "={{ $now.toISO() }}"],
  ["eventType", "PAYMENT_CONFIRMATION_SENT"], ["details", "Customer payment acknowledgement sent"]
]);

setNode("manual-review", "Build Manual Review Alert", [2640, 520], [
  ["invoiceId", "={{ $json.invoiceId }}"], ["customerName", "={{ $json.customerName }}"],
  ["subject", "={{ 'Manual collection review required - ' + $json.invoiceId }}"],
  ["emailBody", "={{ '<p>Review is required before further customer contact.</p><p><strong>Invoice:</strong> ' + $json.invoiceId + '</p><p><strong>Customer:</strong> ' + $json.customerName + '</p><p><strong>Status:</strong> ' + $json.status + '</p><p><strong>Dispute:</strong> ' + $json.disputeStatus + '</p>' }}"]
]);
gmail("send-manual-alert", "Send Manual Review Alert", [2900, 520], "collections-review@example.com",
  "={{ $json.subject }}", "={{ $json.emailBody }}");
dynamoInsert("manual-audit", "Write Manual Review Audit", [3160, 520], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Build Manual Review Alert').item.json.invoiceId }}"], ["eventAt", "={{ $now.toISO() }}"],
  ["eventType", "MANUAL_REVIEW_REQUIRED"], ["details", "Disputed or exceptional invoice routed to human review"]
]);
setNode("scheduled-recipient-block", "Build Scheduled Recipient Block", [3060, 180], [
  ["invoiceId", "={{ $json.invoiceId }}"], ["recipient", "={{ $json.customerEmail }}"],
  ["eventType", "RECIPIENT_BLOCKED"], ["eventAt", "={{ $now.toISO() }}"],
  ["details", "Portfolio safety mode only permits customer recipients at example.com."]
]);
dynamoInsert("scheduled-recipient-audit", "Write Scheduled Recipient Block Audit", [3320, 180], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $json.invoiceId }}"], ["eventAt", "={{ $json.eventAt }}"],
  ["eventType", "={{ $json.eventType }}"], ["details", "={{ $json.details }}"]
]);
add("continue-batch", "Continue Invoice Batch", "n8n-nodes-base.noOp", 1, [4200, 520], {});

// End-of-run report.
add("aggregate-run", "Aggregate Run Results", "n8n-nodes-base.aggregate", 1, [4660, -60], {
  aggregate: "aggregateAllItemData", destinationFieldName: "processedInvoices", options: {}
});
setNode("run-summary", "Build Run Summary", [4900, -60], [
  ["executionId", "={{ $execution.id }}"], ["completedAt", "={{ $now.toISO() }}"],
  ["processedCount", "={{ Array.isArray($json.processedInvoices) ? $json.processedInvoices.length : 0 }}", "number"],
  ["status", "COMPLETED"], ["source", "daily_s3_feed"]
]);
add("report-file", "Convert Run Report to XLSX", "n8n-nodes-base.convertToFile", 1.1, [5140, -60], {
  operation: "xlsx", options: { fileName: "invoice-collections-run-report.xlsx", headerRow: true, sheetName: "Run Summary" }
});
add("store-report", "Store Run Report in S3", "n8n-nodes-base.awsS3", 2, [5380, -60], {
  operation: "upload", bucketName: "invoice-collections-portfolio-demo",
  fileName: "={{ 'reports/' + $now.toFormat('yyyy-LL-dd') + '/' + $execution.id + '.xlsx' }}",
  additionalFields: {}, tagsUi: { tagsValues: [] }
});
gmail("summary-email", "Send Operations Run Summary", [5620, -60], "collections-ops@example.com",
  "={{ 'Invoice collections run completed - ' + $now.toFormat('yyyy-LL-dd') }}",
  "={{ '<p>The daily invoice collections run completed.</p><p><strong>Execution:</strong> ' + $execution.id + '</p><p><strong>Report:</strong> stored in the portfolio S3 bucket.</p>' }}");

// One-time approval API.
add("approval-webhook", "Approval Request Received", "n8n-nodes-base.webhook", 2, [2640, 930], {
  httpMethod: "POST", path: "portfolio-invoice-collection-approval", responseMode: "responseNode", options: {}
}, { webhookId: "portfolio-invoice-collection-approval" });
setNode("normalize-approval", "Normalize Approval Request", [2900, 930], [
  ["invoiceId", "={{ String($json.body?.invoiceId || '').trim().toUpperCase() }}"],
  ["approvalPhrase", "={{ String($json.body?.approvalPhrase || '').trim() }}"],
  ["actorEmail", "={{ String($json.body?.actorEmail || '').trim().toLowerCase() }}"]
]);
dynamoGet("get-approval", "Get Pending Approval", [3160, 930], "invoice_collections_approvals_demo", [
  ["approvalId", "={{ String($json.approvalPhrase || '').split(' ').pop() }}"]
]);
ifNode("approval-valid", "Exact Approval Phrase Valid?", [3420, 930],
  "={{ $json.status === 'PENDING' && $json.approvalPhrase === $('Normalize Approval Request').item.json.approvalPhrase }}",
  true, { type: "boolean", operation: "equals", singleValue: true });
setNode("approval-invalid", "Build Invalid Approval Response", [3420, 1160], [
  ["ok", false, "boolean"], ["status", "approval_invalid"],
  ["message", "The approval phrase is invalid, expired, or already used."]
]);
respond("approval-409", "Return Approval Error", [3680, 1160], 409, "={{ $json }}");
ifNode("approval-recipient", "Approved Recipient Allowed?", [3680, 930],
  "={{ /^[^@\\s]+@example\\.com$/i.test(String($json.customerEmail || '')) }}", true,
  { type: "boolean", operation: "equals", singleValue: true });
setNode("recipient-blocked", "Build Recipient Block Response", [3940, 1160], [
  ["ok", false, "boolean"], ["status", "recipient_blocked"],
  ["message", "Portfolio safety mode only permits recipients at example.com."]
]);
respond("recipient-403", "Return Recipient Block", [4200, 1160], 403, "={{ $json }}");
gmail("send-approved", "Send Approved Customer Reminder", [3940, 930], "={{ $json.customerEmail }}",
  "={{ $json.subject }}", "={{ $json.emailBody }}");
dynamoInsert("approved-audit", "Write Approved Delivery Audit", [4200, 930], "invoice_collections_audit_demo", [
  ["invoiceId", "={{ $('Get Pending Approval').item.json.invoiceId }}"], ["eventAt", "={{ $now.toISO() }}"],
  ["eventType", "APPROVED_REMINDER_SENT"], ["details", "={{ 'Approved by ' + $('Normalize Approval Request').item.json.actorEmail }}"]
]);
dynamoInsert("consume-approval", "Mark Approval Used", [4460, 930], "invoice_collections_approvals_demo", [
  ["approvalId", "={{ $('Get Pending Approval').item.json.approvalId }}"],
  ["invoiceId", "={{ $('Get Pending Approval').item.json.invoiceId }}"], ["status", "USED"],
  ["usedAt", "={{ $now.toISO() }}"], ["usedBy", "={{ $('Normalize Approval Request').item.json.actorEmail }}"]
]);
setNode("approval-success", "Build Approval Success Response", [4720, 930], [
  ["ok", true, "boolean"], ["status", "sent"],
  ["invoiceId", "={{ $('Get Pending Approval').item.json.invoiceId }}"],
  ["message", "Approved customer reminder sent and audited."]
]);
respond("approval-200", "Return Approval Success", [4980, 930], 200, "={{ $json }}");

// Workflow-level failure handling.
add("error-trigger", "Capture Workflow Failure", "n8n-nodes-base.errorTrigger", 1, [-1320, 950], {});
codeNode("redact-error", "Redact Error Context", [-1080, 950], `const execution = $json.execution || {};
const workflow = $json.workflow || {};
const raw = String(execution.error?.message || 'Unknown workflow error');
const redacted = raw.replace(/[A-Za-z0-9_\\-]{24,}/g, '[REDACTED]').slice(0, 500);
return { json: { incidentId: 'INC-' + String(execution.id || $execution.id), workflowName: workflow.name || 'Invoice Collections Automation', executionId: String(execution.id || ''), lastNode: String(execution.lastNodeExecuted || ''), errorMessage: redacted, severity: /credential|forbidden|unauthorized/i.test(raw) ? 'HIGH' : 'MEDIUM', occurredAt: new Date().toISOString() } };`);
dynamoInsert("error-record", "Write Error Record", [-840, 950], "invoice_collections_incidents_demo", [
  ["incidentId", "={{ $json.incidentId }}"], ["occurredAt", "={{ $json.occurredAt }}"],
  ["workflowName", "={{ $json.workflowName }}"], ["executionId", "={{ $json.executionId }}"],
  ["lastNode", "={{ $json.lastNode }}"], ["severity", "={{ $json.severity }}"],
  ["errorMessage", "={{ $json.errorMessage }}"]
]);
gmail("error-email", "Notify Operations on Failure", [-600, 950], "automation-ops@example.com",
  "={{ 'Invoice collections workflow failure - ' + $('Redact Error Context').item.json.incidentId }}",
  "={{ '<p>A workflow failure was recorded.</p><p><strong>Incident:</strong> ' + $('Redact Error Context').item.json.incidentId + '</p><p><strong>Severity:</strong> ' + $('Redact Error Context').item.json.severity + '</p><p><strong>Last node:</strong> ' + $('Redact Error Context').item.json.lastNode + '</p>' }}");

// Main and AI connections.
link("When Chat Message Received", "Normalize Chat Request");
link("Normalize Chat Request", "Load Saved Conversation Context");
link("Normalize Chat Request", "Merge Current and Saved Context", 0, 0);
link("Load Saved Conversation Context", "Merge Current and Saved Context", 0, 1);
link("Merge Current and Saved Context", "Build Grounded Agent Prompt");
link("Build Grounded Agent Prompt", "Invoice Collections Agent");
link("Invoice Collections Agent", "Format Agent Response");
link("Format Agent Response", "Save Conversation Context");
link("Save Conversation Context", "Return Agent Response");
link("Agent Bedrock Chat Model", "Invoice Collections Agent", 0, 0, "ai_languageModel");
link("Bounded Conversation Memory", "Invoice Collections Agent", 0, 0, "ai_memory");
link("Portfolio Search", "Invoice Collections Agent", 0, 0, "ai_tool");
link("Invoice State Lookup", "Invoice Collections Agent", 0, 0, "ai_tool");
link("Reminder Preview", "Invoice Collections Agent", 0, 0, "ai_tool");

link("When Called as Agent Tool", "Route Agent Tool Operation");
link("Route Agent Tool Operation", "Download Agent Portfolio Feed", 0);
link("Route Agent Tool Operation", "Get Invoice State for Agent", 1);
link("Route Agent Tool Operation", "Get Reminder State for Agent", 2);
link("Route Agent Tool Operation", "Return Unsupported Tool Operation", 3);
link("Download Agent Portfolio Feed", "Extract Agent Portfolio CSV");
link("Extract Agent Portfolio CSV", "Filter and Summarize Portfolio");
link("Filter and Summarize Portfolio", "Return Portfolio Search Result");
link("Get Invoice State for Agent", "Format Invoice State Result");
link("Get Reminder State for Agent", "Reminder Preview Eligible?");
link("Reminder Preview Eligible?", "Build Agent Reminder Preview", 0);
link("Reminder Preview Eligible?", "Return Ineligible Preview Result", 1);

link("Daily Collections Schedule", "Download Invoice Aging Feed");
link("Download Invoice Aging Feed", "Extract Invoice CSV");
link("Extract Invoice CSV", "Loop Over Invoices");
link("Loop Over Invoices", "Aggregate Run Results", 0);
link("Loop Over Invoices", "Normalize Invoice Record", 1);
link("Normalize Invoice Record", "Invoice Record Valid?");
link("Invoice Record Valid?", "Get Existing Collection State", 0);
link("Invoice Record Valid?", "Build Data Quality Alert", 1);
link("Build Data Quality Alert", "Send Data Quality Alert");
link("Send Data Quality Alert", "Write Data Quality Audit");
link("Write Data Quality Audit", "Continue Invoice Batch");
link("Normalize Invoice Record", "Merge Invoice and State", 0, 0);
link("Get Existing Collection State", "Merge Invoice and State", 0, 1);
link("Merge Invoice and State", "Calculate Aging and Collection Rule");
link("Calculate Aging and Collection Rule", "Collection Action Required?");
link("Collection Action Required?", "Route Collection Action", 0);
link("Collection Action Required?", "Build No Action Result", 1);
link("Build No Action Result", "Write No Action Audit");
link("Write No Action Audit", "Continue Invoice Batch");

link("Route Collection Action", "Bedrock Reminder Drafting Agent", 0);
link("Route Collection Action", "Bedrock Reminder Drafting Agent", 1);
link("Route Collection Action", "Build Payment Confirmation", 2);
link("Route Collection Action", "Build Manual Review Alert", 3);
link("Drafting Bedrock Chat Model", "Bedrock Reminder Drafting Agent", 0, 0, "ai_languageModel");
link("Bedrock Reminder Drafting Agent", "Parse and Screen AI Draft");
link("Parse and Screen AI Draft", "AI Draft Safe?");
link("AI Draft Safe?", "Prepare Customer Email", 0);
link("AI Draft Safe?", "Apply Safe Reminder Template", 1);
link("Apply Safe Reminder Template", "Prepare Customer Email");
link("Prepare Customer Email", "Human Approval Required?");
link("Human Approval Required?", "Queue Pending Approval", 0);
link("Human Approval Required?", "Scheduled Recipient Allowed?", 1);
link("Scheduled Recipient Allowed?", "Send Customer Payment Reminder", 0);
link("Scheduled Recipient Allowed?", "Build Scheduled Recipient Block", 1);
link("Queue Pending Approval", "Send Approval Request");
link("Send Approval Request", "Write Approval Queue Audit");
link("Write Approval Queue Audit", "Continue Invoice Batch");
link("Send Customer Payment Reminder", "Build Reminder Delivery Record");
link("Build Reminder Delivery Record", "Convert Delivery Evidence to XLSX");
link("Convert Delivery Evidence to XLSX", "Store Delivery Evidence in S3");
link("Store Delivery Evidence in S3", "Record Reminder State");
link("Record Reminder State", "Write Reminder Audit");
link("Write Reminder Audit", "Continue Invoice Batch");
link("Build Payment Confirmation", "Payment Recipient Allowed?");
link("Payment Recipient Allowed?", "Send Payment Confirmation", 0);
link("Payment Recipient Allowed?", "Build Scheduled Recipient Block", 1);
link("Send Payment Confirmation", "Record Payment Confirmation");
link("Record Payment Confirmation", "Write Payment Confirmation Audit");
link("Write Payment Confirmation Audit", "Continue Invoice Batch");
link("Build Manual Review Alert", "Send Manual Review Alert");
link("Send Manual Review Alert", "Write Manual Review Audit");
link("Write Manual Review Audit", "Continue Invoice Batch");
link("Build Scheduled Recipient Block", "Write Scheduled Recipient Block Audit");
link("Write Scheduled Recipient Block Audit", "Continue Invoice Batch");
link("Continue Invoice Batch", "Loop Over Invoices");

link("Aggregate Run Results", "Build Run Summary");
link("Build Run Summary", "Convert Run Report to XLSX");
link("Convert Run Report to XLSX", "Store Run Report in S3");
link("Store Run Report in S3", "Send Operations Run Summary");

link("Approval Request Received", "Normalize Approval Request");
link("Normalize Approval Request", "Get Pending Approval");
link("Get Pending Approval", "Exact Approval Phrase Valid?");
link("Exact Approval Phrase Valid?", "Approved Recipient Allowed?", 0);
link("Exact Approval Phrase Valid?", "Build Invalid Approval Response", 1);
link("Build Invalid Approval Response", "Return Approval Error");
link("Approved Recipient Allowed?", "Send Approved Customer Reminder", 0);
link("Approved Recipient Allowed?", "Build Recipient Block Response", 1);
link("Build Recipient Block Response", "Return Recipient Block");
link("Send Approved Customer Reminder", "Write Approved Delivery Audit");
link("Write Approved Delivery Audit", "Mark Approval Used");
link("Mark Approval Used", "Build Approval Success Response");
link("Build Approval Success Response", "Return Approval Success");

link("Capture Workflow Failure", "Redact Error Context");
link("Redact Error Context", "Write Error Record");
link("Write Error Record", "Notify Operations on Failure");

// Preserve the latest n8n-authored canvas layout and stable node IDs while
// regenerating portable parameters and stripping instance-specific metadata.
if (existingExport?.nodes) {
  const existingByName = new Map(existingExport.nodes.map(node => [node.name, node]));
  for (const item of nodes) {
    const existing = existingByName.get(item.name);
    if (!existing || existing.type !== item.type) continue;
    if (existing.id) item.id = existing.id;
    if (Array.isArray(existing.position)) item.position = existing.position;
    if (item.type === "n8n-nodes-base.stickyNote") {
      if (Number.isFinite(existing.parameters?.width)) item.parameters.width = existing.parameters.width;
      if (Number.isFinite(existing.parameters?.height)) item.parameters.height = existing.parameters.height;
    }
  }
}

const names = new Set();
const ids = new Set();
for (const item of nodes) {
  if (names.has(item.name)) throw new Error(`Duplicate node name: ${item.name}`);
  if (ids.has(item.id)) throw new Error(`Duplicate node id: ${item.id}`);
  names.add(item.name);
  ids.add(item.id);
}

const workflow = {
  name: "AI Invoice Collections Automation - Integrated Agent",
  nodes,
  connections,
  pinData: {},
  active: false,
  settings: { executionOrder: "v1", binaryMode: "separate" },
  versionId: "65cbe44d-f6cf-4a98-8a58-ec53efaa84c5",
  meta: { templateCredsSetupCompleted: false },
  tags: []
};

await writeFile(workflowPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
await Promise.all([
  rm(resolve(workflowDir, "execution-error-handler.json"), { force: true }),
  rm(resolve(workflowDir, "ai-collections-agent.json"), { force: true }),
  rm(resolve(workflowDir, "invoice-portfolio-query-tool.json"), { force: true }),
  rm(resolve(workflowDir, "controlled-reminder-action-tool.json"), { force: true })
]);

const typeCounts = nodes.reduce((counts, item) => {
  counts[item.type] = (counts[item.type] || 0) + 1;
  return counts;
}, {});
console.log(`Built 1 portfolio workflow with ${nodes.length} nodes`);
console.log(`Native AWS: ${(typeCounts["n8n-nodes-base.awsDynamoDb"] || 0) + (typeCounts["n8n-nodes-base.awsS3"] || 0)} nodes; Gmail: ${typeCounts["n8n-nodes-base.gmail"] || 0}; Code: ${typeCounts["n8n-nodes-base.code"] || 0}`);
