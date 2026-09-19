import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = resolve(projectRoot, "workflows");

const code = {
  initialize: String.raw`const payload = $json.body ?? $json;
const receivedAt = new Date().toISOString();
const requestId = String(payload.requestId ?? "").trim().slice(0, 100);
return { json: {
  context: {
    requestId,
    correlationId: requestId || ("generated-" + Date.now()),
    receivedAt,
    workflowVersion: "1.0.0",
    safetyMode: true
  },
  raw: payload
} };`,

  validate: String.raw`const input = $json;
const payload = input.raw || {};
const errors = [];
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const actor = payload.actor && typeof payload.actor === "object" ? payload.actor : {};
const invoice = payload.invoice && typeof payload.invoice === "object" ? payload.invoice : {};
const action = text(payload.action || "preview", 20).toLowerCase();
const amount = Number(invoice.amount);
const currency = text(invoice.currency, 3).toUpperCase();
const dueDate = text(invoice.dueDate, 10);
const asOfDate = text(payload.asOfDate || new Date().toISOString().slice(0, 10), 10);
const customerEmail = text(invoice.customerEmail, 254).toLowerCase();
const serializedSize = JSON.stringify(payload).length;

if (serializedSize > 100000) errors.push("Request exceeds the 100 KB demonstration limit");
if (!input.context.requestId) errors.push("requestId is required");
if (!["preview", "send"].includes(action)) errors.push("action must be preview or send");
if (!text(actor.userId, 100)) errors.push("actor.userId is required");
if (!["ar_analyst", "ar_manager", "finance_admin"].includes(text(actor.role, 30).toLowerCase())) errors.push("actor.role is not supported");
if (!text(invoice.invoiceId, 80)) errors.push("invoice.invoiceId is required");
if (!text(invoice.customerId, 80)) errors.push("invoice.customerId is required");
if (!text(invoice.customerName, 160)) errors.push("invoice.customerName is required");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) errors.push("invoice.customerEmail must be valid");
if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000) errors.push("invoice.amount must be between 0 and 1,000,000,000");
if (!/^[A-Z]{3}$/.test(currency)) errors.push("invoice.currency must be a three-letter ISO code");
if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate + "T00:00:00Z"))) errors.push("invoice.dueDate must be YYYY-MM-DD");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || Number.isNaN(Date.parse(asOfDate + "T00:00:00Z"))) errors.push("asOfDate must be YYYY-MM-DD");

return { json: {
  ...input,
  validation: { valid: errors.length === 0, errors, serializedSize }
} };`,

  validationError: String.raw`return { json: {
  ok: false,
  status: "validation_failed",
  correlationId: $json.context.correlationId,
  errors: $json.validation.errors,
  message: "The request was rejected before policy evaluation or AI processing."
} };`,

  normalize: String.raw`const payload = $json.raw;
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const normalized = {
  request: {
    action: clean(payload.action || "preview", 20).toLowerCase(),
    useAi: payload.useAi === true,
    approvalPhrase: clean(payload.approvalPhrase, 180),
    asOfDate: clean(payload.asOfDate || new Date().toISOString().slice(0, 10), 10)
  },
  actor: {
    userId: clean(payload.actor.userId, 100),
    role: clean(payload.actor.role, 30).toLowerCase()
  },
  invoice: {
    invoiceId: clean(payload.invoice.invoiceId, 80),
    customerId: clean(payload.invoice.customerId, 80),
    customerName: clean(payload.invoice.customerName, 160),
    customerEmail: clean(payload.invoice.customerEmail, 254).toLowerCase(),
    amount: Number(payload.invoice.amount),
    currency: clean(payload.invoice.currency, 3).toUpperCase(),
    dueDate: clean(payload.invoice.dueDate, 10),
    status: clean(payload.invoice.status || "OPEN", 30).toUpperCase(),
    disputeStatus: clean(payload.invoice.disputeStatus || "NONE", 30).toUpperCase()
  },
  policy: {
    minimumAmount: Math.max(0, Number(payload.policy?.minimumAmount ?? 25)),
    allowedCurrencies: Array.isArray(payload.policy?.allowedCurrencies)
      ? payload.policy.allowedCurrencies.map(value => clean(value, 3).toUpperCase()).slice(0, 20)
      : ["USD", "EUR", "GBP", "AUD", "SGD", "PHP"],
    demoRecipientDomain: clean(payload.policy?.demoRecipientDomain || "example.com", 100).toLowerCase()
  }
};
return { json: { context: $json.context, validation: $json.validation, ...normalized } };`,

  fingerprint: String.raw`const data = $json;
const parts = [
  data.invoice.invoiceId.toLowerCase(),
  data.request.action,
  data.request.asOfDate,
  data.actor.userId.toLowerCase()
];
return { json: {
  ...data,
  control: {
    idempotencyKey: parts.join("|"),
    dataClassification: "fictional_demo",
    safetyMode: true
  }
} };`,

  authorize: String.raw`const data = $json;
const sendRoles = ["ar_manager", "finance_admin"];
const actionAuthorized = data.request.action === "preview" || sendRoles.includes(data.actor.role);
return { json: {
  ...data,
  authorization: {
    actionAuthorized,
    reason: actionAuthorized ? "Actor is permitted for the requested action" : "Only AR managers and finance administrators may approve a send action"
  }
} };`,

  authError: String.raw`return { json: {
  ok: false,
  status: "forbidden",
  correlationId: $json.context.correlationId,
  reason: $json.authorization.reason,
  message: "The actor is not authorized for this action."
} };`,

  policy: String.raw`const data = $json;
const daysOverdue = Math.max(0, Math.floor((
  Date.parse(data.request.asOfDate + "T00:00:00Z") - Date.parse(data.invoice.dueDate + "T00:00:00Z")
) / 86400000));
const closed = ["PAID", "SETTLED", "CLOSED", "VOID"].includes(data.invoice.status);
const blocked = ["DISPUTED", "ON_HOLD"].includes(data.invoice.disputeStatus) || ["DISPUTED", "ON_HOLD"].includes(data.invoice.status);
const currencyAllowed = data.policy.allowedCurrencies.includes(data.invoice.currency);
const aboveMinimum = data.invoice.amount >= data.policy.minimumAmount;
let stage = "current";
let tone = "informational";
let riskScore = 0;
if (daysOverdue >= 61) { stage = "legal_review"; tone = "firm"; riskScore += 70; }
else if (daysOverdue >= 31) { stage = "manager_review"; tone = "firm"; riskScore += 50; }
else if (daysOverdue >= 15) { stage = "payment_reminder"; tone = "professional"; riskScore += 30; }
else if (daysOverdue >= 1) { stage = "early_follow_up"; tone = "friendly"; riskScore += 15; }
if (data.invoice.amount >= 50000) riskScore += 20;
else if (data.invoice.amount >= 10000) riskScore += 10;
const eligible = !closed && !blocked && daysOverdue > 0 && currencyAllowed && aboveMinimum;
const reasons = [];
if (closed) reasons.push("Invoice is closed");
if (blocked) reasons.push("Invoice is disputed or on hold");
if (daysOverdue === 0) reasons.push("Invoice is not overdue");
if (!currencyAllowed) reasons.push("Currency is outside the configured policy");
if (!aboveMinimum) reasons.push("Amount is below the configured threshold");
return { json: {
  ...data,
  decision: { eligible, stage, tone, riskScore: Math.min(100, riskScore), daysOverdue, reasons }
} };`,

  noAction: String.raw`return { json: {
  ok: true,
  status: "no_action",
  correlationId: $json.context.correlationId,
  idempotencyKey: $json.control.idempotencyKey,
  invoiceId: $json.invoice.invoiceId,
  decision: $json.decision,
  message: "No reminder was prepared because the invoice did not pass the deterministic policy."
} };`,

  template: String.raw`const data = $json;
const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: data.invoice.currency }).format(data.invoice.amount);
const subject = data.decision.daysOverdue >= 31
  ? "Action required: invoice " + data.invoice.invoiceId
  : "Payment reminder: invoice " + data.invoice.invoiceId;
const body = [
  "Dear " + data.invoice.customerName + ",",
  "",
  "This is a reminder that invoice " + data.invoice.invoiceId + " for " + amount + " was due on " + data.invoice.dueDate + ". It is currently " + data.decision.daysOverdue + " day(s) overdue.",
  "",
  "If payment has already been arranged, please share the remittance details. Otherwise, please confirm the expected payment date.",
  "",
  "Kind regards,",
  "Accounts Receivable Team"
].join("\n");
return { json: { ...data, draft: { subject, body, source: "deterministic_template" }, contentCheck: { safe: true, issues: [] } } };`,

  claudeRequest: String.raw`const data = $json;
const facts = {
  invoiceId: data.invoice.invoiceId,
  customerName: data.invoice.customerName,
  amount: data.invoice.amount,
  currency: data.invoice.currency,
  dueDate: data.invoice.dueDate,
  daysOverdue: data.decision.daysOverdue,
  stage: data.decision.stage,
  tone: data.decision.tone
};
const prompt = [
  "You draft concise business-to-business invoice reminders.",
  "Use only the supplied facts. Do not invent bank details, contacts, penalties, payment plans, legal consequences, promises, or dates.",
  "Return valid JSON only with string fields subject and body.",
  "Keep the body under 220 words and the subject under 120 characters.",
  JSON.stringify(facts)
].join("\n");
return { json: { ...data, aiRequest: {
  model: "claude-3-5-haiku-latest",
  max_tokens: 650,
  temperature: 0.2,
  messages: [{ role: "user", content: prompt }]
} } };`,

  parseClaude: String.raw`const base = $("Build Grounded Claude Request").item.json;
try {
  const raw = $json?.content?.[0]?.text;
  const parsed = JSON.parse(raw);
  if (typeof parsed.subject !== "string" || typeof parsed.body !== "string") throw new Error("Missing subject or body");
  return { json: { ...base, draft: { subject: parsed.subject.trim(), body: parsed.body.trim(), source: "claude" } } };
} catch (error) {
  return { json: { ...base, draft: null, aiWarning: "AI response was unavailable or malformed", contentCheck: { safe: false, issues: ["AI_RESPONSE_INVALID"] } } };
}`,

  screenDraft: String.raw`const data = $json;
const issues = [];
const subject = String(data.draft?.subject || "");
const body = String(data.draft?.body || "");
const combined = subject + "\n" + body;
if (!subject || !body) issues.push("MISSING_CONTENT");
if (subject.length > 120) issues.push("SUBJECT_TOO_LONG");
if (body.length > 4000) issues.push("BODY_TOO_LONG");
if (!combined.includes(data.invoice.invoiceId)) issues.push("INVOICE_ID_MISSING");
if (/\[[^\]]+\]|\{\{[^}]+\}\}/.test(combined)) issues.push("PLACEHOLDER_PRESENT");
if (/bank account|routing number|swift code|iban/i.test(combined)) issues.push("UNAPPROVED_PAYMENT_DETAILS");
if (data.decision.stage !== "legal_review" && /legal action|collection agency|court proceedings/i.test(combined)) issues.push("UNAPPROVED_ESCALATION_LANGUAGE");
return { json: { ...data, contentCheck: { safe: issues.length === 0, issues } } };`,

  approvalPackage: String.raw`const data = $json;
const approvalPhrase = "APPROVE SEND " + data.invoice.invoiceId;
return { json: {
  ...data,
  approval: {
    requiredPhrase: approvalPhrase,
    matched: data.request.action === "send" && data.request.approvalPhrase === approvalPhrase,
    previewGeneratedAt: new Date().toISOString(),
    expiresInMinutes: 10
  }
} };`,

  preview: String.raw`return { json: {
  ok: true,
  status: "preview_ready",
  correlationId: $json.context.correlationId,
  idempotencyKey: $json.control.idempotencyKey,
  invoice: $json.invoice,
  decision: $json.decision,
  draft: $json.draft,
  contentCheck: $json.contentCheck,
  approval: {
    phrase: $json.approval.requiredPhrase,
    expiresInMinutes: $json.approval.expiresInMinutes,
    instruction: "Resubmit with action=send, the same invoice facts, and the exact approval phrase."
  },
  warning: $json.aiWarning || null
} };`,

  approvalError: String.raw`return { json: {
  ok: false,
  status: "approval_required",
  correlationId: $json.context.correlationId,
  invoiceId: $json.invoice.invoiceId,
  requiredApprovalPhrase: $json.approval.requiredPhrase,
  message: "The exact invoice-bound approval phrase is required."
} };`,

  recipientPolicy: String.raw`const data = $json;
const domain = data.invoice.customerEmail.split("@")[1] || "";
const allowed = domain === data.policy.demoRecipientDomain;
return { json: {
  ...data,
  deliveryPolicy: {
    allowed,
    reason: allowed ? "Recipient is inside the fictional demonstration domain" : "Public safety mode only permits the configured demonstration domain"
  }
} };`,

  recipientBlocked: String.raw`return { json: {
  ok: false,
  status: "recipient_blocked",
  correlationId: $json.context.correlationId,
  invoiceId: $json.invoice.invoiceId,
  reason: $json.deliveryPolicy.reason,
  message: "No delivery was attempted."
} };`,

  envelope: String.raw`return { json: {
  ...$json,
  deliveryEnvelope: {
    to: $json.invoice.customerEmail,
    subject: $json.draft.subject,
    body: $json.draft.body,
    messageId: "demo-" + $json.context.correlationId + "-" + Date.now(),
    provider: "simulation"
  }
} };`,

  simulate: String.raw`return { json: {
  ...$json,
  deliveryResult: {
    accepted: true,
    simulated: true,
    providerMessageId: $json.deliveryEnvelope.messageId,
    completedAt: new Date().toISOString()
  }
} };`,

  audit: String.raw`return { json: {
  ...$json,
  auditEvent: {
    eventType: "INVOICE_REMINDER_SIMULATED",
    correlationId: $json.context.correlationId,
    requestId: $json.context.requestId,
    actorId: $json.actor.userId,
    actorRole: $json.actor.role,
    invoiceId: $json.invoice.invoiceId,
    customerId: $json.invoice.customerId,
    stage: $json.decision.stage,
    riskScore: $json.decision.riskScore,
    approvalMatched: true,
    draftSource: $json.draft.source,
    recipientDomain: $json.invoice.customerEmail.split("@")[1],
    occurredAt: new Date().toISOString()
  }
} };`,

  metrics: String.raw`const started = Date.parse($json.context.receivedAt);
return { json: {
  ok: true,
  status: "simulated_sent",
  correlationId: $json.context.correlationId,
  idempotencyKey: $json.control.idempotencyKey,
  delivery: $json.deliveryResult,
  audit: $json.auditEvent,
  metrics: {
    durationMs: Math.max(0, Date.now() - started),
    aiUsed: $json.draft.source === "claude",
    safetyMode: true
  },
  message: "Portfolio safety mode completed successfully; no external email was sent."
} };`,

  errorNormalize: String.raw`const execution = $json.execution || {};
const workflow = $json.workflow || {};
const rawMessage = String(execution.error?.message || "Unknown workflow error");
const redacted = rawMessage
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
  .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
  .replace(/(api[_-]?key[=:\s]+)[^\s,;]+/gi, "$1[REDACTED]");
return { json: {
  incident: {
    incidentId: "incident-" + Date.now(),
    workflowName: String(workflow.name || "unknown").slice(0, 120),
    executionId: String(execution.id || "unknown").slice(0, 100),
    lastNode: String(execution.lastNodeExecuted || "unknown").slice(0, 120),
    message: redacted.slice(0, 1000),
    occurredAt: new Date().toISOString()
  }
} };`,

  errorSeverity: String.raw`const data = $json;
const message = data.incident.message.toLowerCase();
let severity = "medium";
if (/credential|unauthorized|forbidden|data loss|delivery/.test(message)) severity = "high";
if (/timeout|rate limit|temporar/.test(message)) severity = "medium";
if (/validation|invalid input/.test(message)) severity = "low";
return { json: { ...data, classification: { severity, retryable: /timeout|rate limit|temporar/.test(message) } } };`,

  alert: String.raw`return { json: {
  ...$json,
  alert: {
    channel: "simulation",
    title: "[" + $json.classification.severity.toUpperCase() + "] n8n workflow incident",
    summary: $json.incident.workflowName + " failed at " + $json.incident.lastNode,
    incidentId: $json.incident.incidentId,
    retryable: $json.classification.retryable,
    sensitiveDataRedacted: true
  }
} };`,

  errorAudit: String.raw`return { json: {
  ok: true,
  status: "incident_recorded",
  incident: $json.incident,
  classification: $json.classification,
  alert: $json.alert,
  note: "Public portfolio mode simulates alert delivery."
} };`
};

const node = (id, name, type, version, position, parameters = {}, extra = {}) => ({
  id, name, type, typeVersion: version, position, parameters, ...extra
});
const sticky = (id, name, position, width, height, color, content) =>
  node(id, name, "n8n-nodes-base.stickyNote", 1, position, { width, height, color, content });
const codeNode = (id, name, position, jsCode) =>
  node(id, name, "n8n-nodes-base.code", 2, position, { jsCode });
const ifNode = (id, name, position, leftValue, operation = "true", rightValue = "") =>
  node(id, name, "n8n-nodes-base.if", 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict", version: 2 },
      conditions: [{ id: id + "-condition", leftValue, rightValue,
        operator: operation === "true"
          ? { type: "boolean", operation: "true", singleValue: true }
          : { type: "string", operation } }],
      combinator: "and"
    }, options: {}
  });
const respond = (id, name, position, responseCode) =>
  node(id, name, "n8n-nodes-base.respondToWebhook", 1.4, position, {
    respondWith: "json", responseBody: "={{ $json }}", options: { responseCode }
  });

const main = {
  name: "AI Invoice Collections Automation - Preview and Approval",
  nodes: [
    sticky("note-1", "Process 1 - Request Intake", [-1280, -330], 720, 650, 5,
      "## Process 1 — Request intake\n**Purpose:** establish traceability before processing business data.\n\n**Controls**\n- POST-only webhook\n- correlation and request identifiers\n- workflow version and safety-mode markers\n\n**Output:** a bounded execution context plus the untrusted request."),
    node("webhook", "Receive Collection Request", "n8n-nodes-base.webhook", 2, [-1200, 0],
      { httpMethod: "POST", path: "ai-invoice-collections", responseMode: "responseNode", options: {} },
      { webhookId: "0a4d132d-f53a-4f07-af68-cc73ee28f0ac" }),
    codeNode("initialize", "Initialize Execution Context", [-970, 0], code.initialize),

    sticky("note-2", "Process 2 - Contract Validation", [-520, -330], 950, 650, 3,
      "## Process 2 — Contract validation and minimization\n**Purpose:** reject malformed or oversized input before policy evaluation or AI.\n\n**Controls**\n- required field and role checks\n- strict date, email, amount, and currency validation\n- 100 KB request limit\n- string length bounds\n- data minimization and normalization\n\n**Failure:** HTTP 400 with a correlation ID; no downstream action."),
    codeNode("validate", "Validate Request Contract", [-470, 0], code.validate),
    ifNode("valid", "Contract Valid?", [-240, 0], "={{ $json.validation.valid }}"),
    codeNode("validation-error", "Build Validation Error", [-240, 520], code.validationError),
    respond("validation-response", "Return HTTP 400", [-10, 520], 400),
    codeNode("normalize", "Normalize and Minimize Data", [-10, 0], code.normalize),
    codeNode("fingerprint", "Build Control Metadata", [220, 0], code.fingerprint),

    sticky("note-3", "Process 3 - Authorization and Policy", [480, -330], 970, 650, 2,
      "## Process 3 — Authorization and deterministic policy\n**Purpose:** keep financial and authorization decisions outside the LLM.\n\n**Controls**\n- analysts may preview; managers/admins may approve send\n- closed, disputed, and on-hold invoices excluded\n- minimum amount and currency policy\n- deterministic aging stage and risk score\n\n**Output:** an explainable eligibility decision."),
    codeNode("authorize", "Authorize Requested Action", [530, 0], code.authorize),
    ifNode("authorized", "Action Authorized?", [760, 0], "={{ $json.authorization.actionAuthorized }}"),
    codeNode("auth-error", "Build Authorization Error", [760, 520], code.authError),
    respond("auth-response", "Return HTTP 403", [990, 520], 403),
    codeNode("policy", "Apply Collection Policy", [990, 0], code.policy),
    ifNode("eligible", "Invoice Eligible?", [1220, 0], "={{ $json.decision.eligible }}"),
    codeNode("no-action", "Build No-Action Result", [1220, 520], code.noAction),
    respond("no-action-response", "Return Policy Result", [1450, 520], 200),

    sticky("note-4", "Process 4 - Draft Generation", [1500, -330], 1220, 650, 4,
      "## Process 4 — Controlled draft generation\n**Purpose:** create a customer-ready reminder without delegating policy decisions to AI.\n\n**Modes**\n- deterministic template: credential-free and repeatable\n- Claude: optional, grounded only in approved invoice facts\n\n**Reliability**\n- low temperature and bounded output\n- no payment details, penalties, promises, or invented facts\n- AI failure continues to a safe fallback path."),
    ifNode("ai-mode", "Claude Enabled?", [1560, 0], "={{ $json.request.useAi }}"),
    codeNode("template", "Build Deterministic Draft", [1790, 150], code.template),
    codeNode("claude-request", "Build Grounded Claude Request", [1790, -150], code.claudeRequest),
    node("claude", "Generate Claude Draft", "n8n-nodes-base.httpRequest", 4.2, [2020, -150], {
      method: "POST", url: "https://api.anthropic.com/v1/messages", authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth", sendHeaders: true,
      headerParameters: { parameters: [
        { name: "anthropic-version", value: "2023-06-01" },
        { name: "content-type", value: "application/json" }
      ] },
      sendBody: true, contentType: "raw", rawContentType: "application/json",
      body: "={{ JSON.stringify($json.aiRequest) }}", options: { timeout: 15000 }
    }, { onError: "continueRegularOutput" }),
    codeNode("parse-claude", "Parse Claude Response", [2250, -150], code.parseClaude),

    sticky("note-5", "Process 5 - Content Assurance", [2760, -330], 730, 650, 6,
      "## Process 5 — Content assurance\n**Purpose:** treat generated text as untrusted output.\n\n**Checks**\n- required subject and body\n- length limits\n- invoice reference present\n- no unresolved placeholders\n- no invented bank details\n- escalation language allowed only at the configured stage\n\n**Failure:** discard the AI draft and rebuild from the deterministic template."),
    codeNode("screen", "Screen Generated Content", [2820, -120], code.screenDraft),
    ifNode("content-safe", "Draft Safe?", [3050, -120], "={{ $json.contentCheck.safe }}"),
    codeNode("fallback", "Replace with Safe Template", [3280, 120], code.template),

    sticky("note-6", "Process 6 - Human Approval", [3540, -330], 1080, 650, 7,
      "## Process 6 — Human approval\n**Purpose:** separate read-only preview from an action request.\n\n**Controls**\n- preview returns the decision, draft, and approval instruction\n- send requires an exact invoice-bound phrase\n- actor authorization was already verified\n- incorrect approval returns HTTP 409\n\n**Production note:** use a durable, expiring, one-time approval record before real delivery."),
    codeNode("approval-package", "Prepare Approval Package", [3600, 0], code.approvalPackage),
    ifNode("preview", "Preview Request?", [3830, 0], "={{ $json.request.action }}", "equals", "preview"),
    codeNode("preview-body", "Build Preview Response", [4060, -150], code.preview),
    respond("preview-response", "Return Preview", [4290, -150], 200),
    ifNode("approval", "Exact Approval Phrase?", [4060, 100], "={{ $json.approval.matched }}"),
    codeNode("approval-error", "Build Approval Error", [4290, 300], code.approvalError),
    respond("approval-response", "Return HTTP 409", [4520, 300], 409),

    sticky("note-7", "Process 7 - Delivery Safety", [4670, -330], 950, 650, 5,
      "## Process 7 — Delivery safety\n**Purpose:** demonstrate a delivery adapter without risking real communication.\n\n**Controls**\n- allow-list restricted to the fictional demo domain\n- normalized outbound envelope\n- no live email node in the public export\n- provider result is explicitly marked simulated\n\n**Production note:** replace with an approved provider, suppression checks, and atomic idempotency."),
    codeNode("recipient-policy", "Enforce Demo Recipient Policy", [4730, 0], code.recipientPolicy),
    ifNode("recipient-allowed", "Recipient Allowed?", [4960, 0], "={{ $json.deliveryPolicy.allowed }}"),
    codeNode("recipient-error", "Build Recipient Block", [4960, 520], code.recipientBlocked),
    respond("recipient-response", "Return HTTP 403 - Recipient", [5190, 520], 403),
    codeNode("envelope", "Prepare Delivery Envelope", [5190, 0], code.envelope),
    codeNode("simulate", "Simulate Email Provider", [5420, 0], code.simulate),

    sticky("note-8", "Process 8 - Audit and Observability", [5670, -330], 900, 650, 4,
      "## Process 8 — Audit and observability\n**Purpose:** return evidence suitable for operations and downstream logging.\n\n**Outputs**\n- correlation and idempotency identifiers\n- actor, invoice, policy stage, and risk score\n- approval and draft-source evidence\n- recipient domain only, not the full address\n- execution duration and AI-use indicator\n\nThe public export returns the event; production should persist it centrally."),
    codeNode("audit", "Create Structured Audit Event", [5730, 0], code.audit),
    codeNode("metrics", "Build Execution Metrics", [5960, 0], code.metrics),
    respond("success-response", "Return Controlled Result", [6190, 0], 200)
  ],
  connections: {
    "Receive Collection Request": { main: [[{ node: "Initialize Execution Context", type: "main", index: 0 }]] },
    "Initialize Execution Context": { main: [[{ node: "Validate Request Contract", type: "main", index: 0 }]] },
    "Validate Request Contract": { main: [[{ node: "Contract Valid?", type: "main", index: 0 }]] },
    "Contract Valid?": { main: [[{ node: "Normalize and Minimize Data", type: "main", index: 0 }], [{ node: "Build Validation Error", type: "main", index: 0 }]] },
    "Build Validation Error": { main: [[{ node: "Return HTTP 400", type: "main", index: 0 }]] },
    "Normalize and Minimize Data": { main: [[{ node: "Build Control Metadata", type: "main", index: 0 }]] },
    "Build Control Metadata": { main: [[{ node: "Authorize Requested Action", type: "main", index: 0 }]] },
    "Authorize Requested Action": { main: [[{ node: "Action Authorized?", type: "main", index: 0 }]] },
    "Action Authorized?": { main: [[{ node: "Apply Collection Policy", type: "main", index: 0 }], [{ node: "Build Authorization Error", type: "main", index: 0 }]] },
    "Build Authorization Error": { main: [[{ node: "Return HTTP 403", type: "main", index: 0 }]] },
    "Apply Collection Policy": { main: [[{ node: "Invoice Eligible?", type: "main", index: 0 }]] },
    "Invoice Eligible?": { main: [[{ node: "Claude Enabled?", type: "main", index: 0 }], [{ node: "Build No-Action Result", type: "main", index: 0 }]] },
    "Build No-Action Result": { main: [[{ node: "Return Policy Result", type: "main", index: 0 }]] },
    "Claude Enabled?": { main: [[{ node: "Build Grounded Claude Request", type: "main", index: 0 }], [{ node: "Build Deterministic Draft", type: "main", index: 0 }]] },
    "Build Grounded Claude Request": { main: [[{ node: "Generate Claude Draft", type: "main", index: 0 }]] },
    "Generate Claude Draft": { main: [[{ node: "Parse Claude Response", type: "main", index: 0 }]] },
    "Parse Claude Response": { main: [[{ node: "Screen Generated Content", type: "main", index: 0 }]] },
    "Screen Generated Content": { main: [[{ node: "Draft Safe?", type: "main", index: 0 }]] },
    "Draft Safe?": { main: [[{ node: "Prepare Approval Package", type: "main", index: 0 }], [{ node: "Replace with Safe Template", type: "main", index: 0 }]] },
    "Build Deterministic Draft": { main: [[{ node: "Prepare Approval Package", type: "main", index: 0 }]] },
    "Replace with Safe Template": { main: [[{ node: "Prepare Approval Package", type: "main", index: 0 }]] },
    "Prepare Approval Package": { main: [[{ node: "Preview Request?", type: "main", index: 0 }]] },
    "Preview Request?": { main: [[{ node: "Build Preview Response", type: "main", index: 0 }], [{ node: "Exact Approval Phrase?", type: "main", index: 0 }]] },
    "Build Preview Response": { main: [[{ node: "Return Preview", type: "main", index: 0 }]] },
    "Exact Approval Phrase?": { main: [[{ node: "Enforce Demo Recipient Policy", type: "main", index: 0 }], [{ node: "Build Approval Error", type: "main", index: 0 }]] },
    "Build Approval Error": { main: [[{ node: "Return HTTP 409", type: "main", index: 0 }]] },
    "Enforce Demo Recipient Policy": { main: [[{ node: "Recipient Allowed?", type: "main", index: 0 }]] },
    "Recipient Allowed?": { main: [[{ node: "Prepare Delivery Envelope", type: "main", index: 0 }], [{ node: "Build Recipient Block", type: "main", index: 0 }]] },
    "Build Recipient Block": { main: [[{ node: "Return HTTP 403 - Recipient", type: "main", index: 0 }]] },
    "Prepare Delivery Envelope": { main: [[{ node: "Simulate Email Provider", type: "main", index: 0 }]] },
    "Simulate Email Provider": { main: [[{ node: "Create Structured Audit Event", type: "main", index: 0 }]] },
    "Create Structured Audit Event": { main: [[{ node: "Build Execution Metrics", type: "main", index: 0 }]] },
    "Build Execution Metrics": { main: [[{ node: "Return Controlled Result", type: "main", index: 0 }]] }
  },
  pinData: {}, active: false,
  settings: { executionOrder: "v1", saveManualExecutions: true, callerPolicy: "workflowsFromSameOwner" },
  versionId: "3a32a43e-5358-46b6-b454-e9ee85d61f58",
  meta: { templateCredsSetupCompleted: false }, tags: []
};

const errorHandler = {
  name: "AI Invoice Collections Automation - Execution Error Handler",
  nodes: [
    sticky("error-note-1", "Error Process 1 - Capture", [-850, -300], 700, 560, 3,
      "## Error process 1 — Capture and sanitize\nReceives failed-execution metadata through n8n's Error Trigger. Email addresses, bearer tokens, and API-key-like values are redacted before an alert payload is built."),
    node("error-trigger", "Capture Workflow Failure", "n8n-nodes-base.errorTrigger", 1, [-770, 0], {}),
    codeNode("normalize-error", "Normalize and Redact Error", [-520, 0], code.errorNormalize),
    sticky("error-note-2", "Error Process 2 - Classification", [-100, -300], 620, 560, 2,
      "## Error process 2 — Classify\nAssigns an operational severity and retry hint using deterministic rules. The LLM is never used to decide incident priority."),
    codeNode("severity", "Classify Incident Severity", [-20, 0], code.errorSeverity),
    sticky("error-note-3", "Error Process 3 - Alert", [570, -300], 650, 560, 5,
      "## Error process 3 — Prepare alert\nCreates a minimal alert containing incident ID, workflow, last node, severity, and retry guidance. Public mode does not call Slack, Teams, PagerDuty, or email."),
    codeNode("alert", "Build Redacted Alert", [650, 0], code.alert),
    sticky("error-note-4", "Error Process 4 - Audit", [1270, -300], 650, 560, 4,
      "## Error process 4 — Audit result\nReturns a structured incident object for inspection. A production workflow would persist it centrally and route the alert through an approved operational channel."),
    codeNode("error-audit", "Build Incident Audit Result", [1350, 0], code.errorAudit)
  ],
  connections: {
    "Capture Workflow Failure": { main: [[{ node: "Normalize and Redact Error", type: "main", index: 0 }]] },
    "Normalize and Redact Error": { main: [[{ node: "Classify Incident Severity", type: "main", index: 0 }]] },
    "Classify Incident Severity": { main: [[{ node: "Build Redacted Alert", type: "main", index: 0 }]] },
    "Build Redacted Alert": { main: [[{ node: "Build Incident Audit Result", type: "main", index: 0 }]] }
  },
  pinData: {}, active: false,
  settings: { executionOrder: "v1", saveManualExecutions: true },
  versionId: "8c369b39-05d7-4f2b-a8af-b4b5cfabfdf4",
  meta: { templateCredsSetupCompleted: false }, tags: []
};

await mkdir(workflowDir, { recursive: true });
await Promise.all([
  writeFile(resolve(workflowDir, "ai-invoice-collections-automation.json"), JSON.stringify(main, null, 2) + "\n", "utf8"),
  writeFile(resolve(workflowDir, "execution-error-handler.json"), JSON.stringify(errorHandler, null, 2) + "\n", "utf8")
]);
console.log("Built 2 generic n8n workflow exports");
