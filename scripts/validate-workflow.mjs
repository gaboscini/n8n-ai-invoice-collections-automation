import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = resolve(root, "workflows");
const files = (await readdir(workflowDir)).filter(file => extname(file) === ".json").sort();
const failures = [];
let totalNodes = 0;

if (files.length !== 2) failures.push(new Error(`Expected 2 workflow exports, found ${files.length}`));

for (const filename of files) {
  const raw = await readFile(resolve(workflowDir, filename), "utf8");
  const workflow = JSON.parse(raw);
  const names = new Set();
  const ids = new Set();
  totalNodes += workflow.nodes.length;

  if (workflow.active !== false) failures.push(new Error(`${filename}: workflow must be inactive`));
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length < 5) failures.push(new Error(`${filename}: incomplete workflow`));

  for (const node of workflow.nodes) {
    if (!node.name || names.has(node.name)) failures.push(new Error(`${filename}: duplicate or missing node name ${node.name}`));
    if (!node.id || ids.has(node.id)) failures.push(new Error(`${filename}: duplicate or missing node id ${node.id}`));
    names.add(node.name);
    ids.add(node.id);
    if (node.credentials) failures.push(new Error(`${filename}: credential object found in ${node.name}`));
    if (node.type === "n8n-nodes-base.code") {
      try { new Function(node.parameters.jsCode); }
      catch (error) { failures.push(new Error(`${filename}: ${node.name} does not compile: ${error.message}`)); }
    }
  }

  for (const [source, groups] of Object.entries(workflow.connections || {})) {
    if (!names.has(source)) failures.push(new Error(`${filename}: missing connection source ${source}`));
    for (const outputs of Object.values(groups)) {
      for (const branch of outputs) {
        for (const target of branch || []) {
          if (!names.has(target.node)) failures.push(new Error(`${filename}: missing target ${target.node}`));
        }
      }
    }
  }

  const functionalNodes = workflow.nodes.filter(node => node.type !== "n8n-nodes-base.stickyNote");
  for (let i = 0; i < functionalNodes.length; i++) {
    for (let j = i + 1; j < functionalNodes.length; j++) {
      const [ax, ay] = functionalNodes[i].position;
      const [bx, by] = functionalNodes[j].position;
      if (Math.abs(ax - bx) < 125 && Math.abs(ay - by) < 65) {
        failures.push(new Error(`${filename}: nodes may overlap: ${functionalNodes[i].name} / ${functionalNodes[j].name}`));
      }
    }
  }

  const notes = workflow.nodes.filter(node => node.type === "n8n-nodes-base.stickyNote");
  if (filename === "ai-invoice-collections-automation.json" && notes.length < 8) {
    failures.push(new Error(`${filename}: expected at least 8 process notes`));
  }

  const secretPatterns = [
    /sk-ant-[a-zA-Z0-9_-]{16,}/,
    /api[_-]?key["'\s:=]+[a-zA-Z0-9_-]{16,}/i,
    /authorization["'\s:=]+bearer\s+[a-zA-Z0-9._-]+/i
  ];
  for (const pattern of secretPatterns) {
    if (pattern.test(raw)) failures.push(new Error(`${filename}: likely secret detected`));
  }
}

const main = JSON.parse(await readFile(resolve(workflowDir, "ai-invoice-collections-automation.json"), "utf8"));
const mainNames = new Set(main.nodes.map(node => node.name));
for (const required of [
  "Validate Request Contract", "Authorize Requested Action", "Apply Collection Policy",
  "Build Grounded Claude Request", "Screen Generated Content", "Prepare Approval Package",
  "Enforce Demo Recipient Policy", "Create Structured Audit Event", "Build Execution Metrics"
]) {
  if (!mainNames.has(required)) failures.push(new Error(`Main workflow is missing ${required}`));
}

if (failures.length) {
  failures.forEach(error => console.error(`FAIL: ${error.message}`));
  process.exit(1);
}

console.log(`PASS: ${files.length} workflows and ${totalNodes} nodes validated`);
console.log("PASS: all Code nodes compile and every connection resolves");
console.log("PASS: process notes are present and functional nodes do not overlap");
console.log("PASS: exports are inactive and contain no credential objects or detected secrets");
