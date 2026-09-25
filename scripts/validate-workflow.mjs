import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = resolve(root, "workflows");
const files = (await readdir(workflowDir)).filter(file => extname(file) === ".json").sort();
const failures = [];

if (files.length !== 1 || files[0] !== "ai-invoice-collections-automation.json") {
  failures.push(new Error(`Expected one integrated workflow export, found: ${files.join(", ") || "none"}`));
}

const raw = await readFile(resolve(workflowDir, "ai-invoice-collections-automation.json"), "utf8");
const workflow = JSON.parse(raw);
const names = new Set();
const ids = new Set();

if (workflow.active !== false) failures.push(new Error("Portfolio workflow must be inactive"));
if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 104) failures.push(new Error("Portfolio workflow is incomplete"));

for (const node of workflow.nodes) {
  if (!node.name || names.has(node.name)) failures.push(new Error(`Duplicate or missing node name: ${node.name}`));
  if (!node.id || ids.has(node.id)) failures.push(new Error(`Duplicate or missing node id: ${node.id}`));
  names.add(node.name);
  ids.add(node.id);
  if (node.credentials) failures.push(new Error(`Credential object found in public export: ${node.name}`));
  if (node.type === "n8n-nodes-base.code") {
    try { new Function(node.parameters.jsCode); }
    catch (error) { failures.push(new Error(`${node.name} does not compile: ${error.message}`)); }
  }
}

for (const [source, groups] of Object.entries(workflow.connections || {})) {
  if (!names.has(source)) failures.push(new Error(`Missing connection source: ${source}`));
  for (const outputs of Object.values(groups)) {
    for (const branch of outputs) {
      for (const target of branch || []) {
        if (!names.has(target.node)) failures.push(new Error(`Missing connection target: ${target.node}`));
      }
    }
  }
}

const notes = workflow.nodes.filter(node => node.type === "n8n-nodes-base.stickyNote");
const functionalNodes = workflow.nodes.filter(node => node.type !== "n8n-nodes-base.stickyNote");
if (notes.length !== 10) failures.push(new Error(`Expected 10 background section notes, found ${notes.length}`));
if (functionalNodes.length !== 94) failures.push(new Error(`Expected 94 functional nodes, found ${functionalNodes.length}`));
if (!workflow.nodes.slice(0, notes.length).every(node => node.type === "n8n-nodes-base.stickyNote")) {
  failures.push(new Error("Sticky Notes must be first in the export so they render in the background"));
}

for (const note of notes) {
  const { width, height, content } = note.parameters || {};
  if (!String(content || "").startsWith("## ")) failures.push(new Error(`Section note needs a heading: ${note.name}`));
  if (String(content || "").length > 350) failures.push(new Error(`Section note is too verbose: ${note.name}`));
  if (width < 700 || width > 3000 || height < 350 || height > 1000) {
    failures.push(new Error(`Section note dimensions are outside the portfolio layout range: ${note.name}`));
  }
}

for (let i = 0; i < notes.length; i++) {
  for (let j = i + 1; j < notes.length; j++) {
    const a = notes[i];
    const b = notes[j];
    const [ax, ay] = a.position;
    const [bx, by] = b.position;
    const aw = a.parameters.width;
    const ah = a.parameters.height;
    const bw = b.parameters.width;
    const bh = b.parameters.height;
    if (ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by) {
      failures.push(new Error(`Section notes overlap: ${a.name} / ${b.name}`));
    }
  }
}

for (let i = 0; i < functionalNodes.length; i++) {
  for (let j = i + 1; j < functionalNodes.length; j++) {
    const [ax, ay] = functionalNodes[i].position;
    const [bx, by] = functionalNodes[j].position;
    if (Math.abs(ax - bx) < 220 && Math.abs(ay - by) < 80) {
      failures.push(new Error(`Functional nodes or titles may overlap: ${functionalNodes[i].name} / ${functionalNodes[j].name}`));
    }
  }
}

for (const node of functionalNodes) {
  const [x, y] = node.position;
  const covered = notes.some(note => {
    const [nx, ny] = note.position;
    return x >= nx && x + 180 <= nx + note.parameters.width &&
      y >= ny && y + 100 <= ny + note.parameters.height;
  });
  if (!covered) failures.push(new Error(`Functional node is not contained by a section note: ${node.name}`));
}

const typeCounts = workflow.nodes.reduce((counts, node) => {
  counts[node.type] = (counts[node.type] || 0) + 1;
  return counts;
}, {});

const minimumTypes = {
  "n8n-nodes-base.awsDynamoDb": 19,
  "n8n-nodes-base.awsS3": 4,
  "n8n-nodes-base.gmail": 7,
  "n8n-nodes-base.set": 14,
  "n8n-nodes-base.if": 5,
  "n8n-nodes-base.switch": 2,
  "n8n-nodes-base.extractFromFile": 2,
  "n8n-nodes-base.splitInBatches": 1,
  "n8n-nodes-base.merge": 2,
  "n8n-nodes-base.convertToFile": 2,
  "n8n-nodes-base.scheduleTrigger": 1,
  "n8n-nodes-base.webhook": 1,
  "n8n-nodes-base.errorTrigger": 1,
  "@n8n/n8n-nodes-langchain.agent": 2,
  "@n8n/n8n-nodes-langchain.lmChatAwsBedrock": 2,
  "@n8n/n8n-nodes-langchain.toolWorkflow": 3
};
for (const [type, minimum] of Object.entries(minimumTypes)) {
  if ((typeCounts[type] || 0) < minimum) failures.push(new Error(`Expected at least ${minimum} nodes of type ${type}, found ${typeCounts[type] || 0}`));
}
if ((typeCounts["n8n-nodes-base.code"] || 0) > 4) {
  failures.push(new Error(`Too many Code nodes: ${typeCounts["n8n-nodes-base.code"]}`));
}

for (const required of [
  "Daily Collections Schedule", "Download Invoice Aging Feed", "Extract Invoice CSV", "Loop Over Invoices",
  "Get Existing Collection State", "Merge Invoice and State", "Calculate Aging and Collection Rule",
  "Route Collection Action", "Bedrock Reminder Drafting Agent", "Drafting Bedrock Chat Model",
  "Parse and Screen AI Draft", "Apply Safe Reminder Template", "Send Customer Payment Reminder",
  "Send Payment Confirmation", "Send Manual Review Alert", "Queue Pending Approval", "Send Approval Request",
  "Store Delivery Evidence in S3", "Record Reminder State", "Write Reminder Audit",
  "Aggregate Run Results", "Store Run Report in S3", "Send Operations Run Summary",
  "Invoice Collections Agent", "Agent Bedrock Chat Model", "Load Saved Conversation Context",
  "Save Conversation Context", "Portfolio Search", "Download Agent Portfolio Feed",
  "Filter and Summarize Portfolio", "Invoice State Lookup", "Reminder Preview",
  "Approval Request Received", "Exact Approval Phrase Valid?", "Send Approved Customer Reminder",
  "Capture Workflow Failure", "Write Error Record", "Notify Operations on Failure"
]) {
  if (!names.has(required)) failures.push(new Error(`Portfolio workflow is missing ${required}`));
}

for (const toolName of ["Portfolio Search", "Invoice State Lookup", "Reminder Preview"]) {
  const linked = workflow.connections?.[toolName]?.ai_tool?.[0]?.some(connection =>
    connection.node === "Invoice Collections Agent" && connection.type === "ai_tool"
  );
  if (!linked) failures.push(new Error(`${toolName} is not connected to the conversational agent`));
  const tool = workflow.nodes.find(node => node.name === toolName);
  if (tool?.parameters?.workflowId?.value !== "REPLACE_WITH_THIS_WORKFLOW_ID") {
    failures.push(new Error(`${toolName} must use the visible self-workflow placeholder`));
  }
}

for (const node of workflow.nodes.filter(node => node.type === "n8n-nodes-base.gmail")) {
  const recipient = String(node.parameters.sendTo || "");
  if (!recipient.startsWith("={{") && !recipient.endsWith("@example.com")) {
    failures.push(new Error(`Public email node uses a non-example recipient: ${node.name}`));
  }
}
for (const node of workflow.nodes.filter(node => node.type === "n8n-nodes-base.awsS3")) {
  if (node.parameters.bucketName !== "invoice-collections-portfolio-demo") {
    failures.push(new Error(`S3 node must use the generic demo bucket: ${node.name}`));
  }
}
for (const node of workflow.nodes.filter(node => node.type === "n8n-nodes-base.awsDynamoDb")) {
  if (!String(node.parameters.tableName || "").endsWith("_demo")) {
    failures.push(new Error(`DynamoDB node must use a generic demo table: ${node.name}`));
  }
}

const sampleInvoices = JSON.parse(await readFile(resolve(root, "samples", "fictional-invoices.json"), "utf8"));
if (sampleInvoices.length !== 8) failures.push(new Error("Expected 8 fictional invoice records"));
if (new Set(sampleInvoices.map(row => row.invoiceId)).size !== sampleInvoices.length) {
  failures.push(new Error("Fictional invoice IDs must be unique"));
}
if (sampleInvoices.some(row => !String(row.customerEmail).endsWith(".example.com"))) {
  failures.push(new Error("Every fictional recipient must use the example.com safety domain"));
}
const sampleCsv = await readFile(resolve(root, "samples", "daily-invoice-aging.csv"), "utf8");
const csvLines = sampleCsv.trim().split(/\r?\n/);
if (csvLines.length !== sampleInvoices.length + 1) failures.push(new Error("Fictional CSV row count does not match JSON fixtures"));
for (const header of ["invoiceId", "customerName", "customerEmail", "amountUsd", "dueDate", "status", "disputeStatus", "accountOwner"]) {
  if (!csvLines[0].split(",").includes(header)) failures.push(new Error(`Fictional CSV is missing ${header}`));
}
if (csvLines.slice(1).some(line => !line.includes(".example.com"))) {
  failures.push(new Error("Every fictional CSV recipient must use the example.com safety domain"));
}

const prohibited = [/ARNotify/i, /eCloudvalley/i, /aiagent\.ecv/i];
for (const pattern of prohibited) {
  if (pattern.test(raw)) failures.push(new Error(`Proprietary identifier detected: ${pattern}`));
}
const secretPatterns = [
  /sk-ant-[a-zA-Z0-9_-]{16,}/,
  /api[_-]?key["'\s:=]+[a-zA-Z0-9_-]{16,}/i,
  /authorization["'\s:=]+bearer\s+[a-zA-Z0-9._-]+/i,
  /AKIA[0-9A-Z]{16}/
];
for (const pattern of secretPatterns) {
  if (pattern.test(raw)) failures.push(new Error("Likely secret detected in workflow export"));
}

if (failures.length) {
  failures.forEach(error => console.error(`FAIL: ${error.message}`));
  process.exit(1);
}

console.log(`PASS: one integrated portfolio workflow with ${workflow.nodes.length} nodes validated`);
console.log(`PASS: ${typeCounts["n8n-nodes-base.awsDynamoDb"]} DynamoDB, ${typeCounts["n8n-nodes-base.awsS3"]} S3, and ${typeCounts["n8n-nodes-base.gmail"]} Gmail nodes are present`);
console.log(`PASS: Code nodes reduced to ${typeCounts["n8n-nodes-base.code"]}; native Set, If, Switch, Merge, Loop, Extract, Aggregate, and Convert nodes are used`);
console.log("PASS: all Code nodes compile, connections resolve, section notes do not overlap, and functional nodes do not overlap");
console.log("PASS: inactive export contains no credentials, secrets, proprietary identifiers, or live recipient addresses");
