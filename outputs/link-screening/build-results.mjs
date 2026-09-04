import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const inputPath = "/Users/ai6677/Downloads/29/实验表格.xlsx";
const outputDir = "/Users/ai6677/Documents/GitHub/autofill_forms_ai/outputs/link-screening";
const outputPath = `${outputDir}/付费外链筛选结果.xlsx`;

function text(value) {
  return value == null ? "" : String(value).trim();
}

function normalizeUrl(value) {
  const raw = text(value);
  const match = raw.match(/https?:\/\/[^\s)）]+/i);
  return match ? match[0] : raw;
}

function trafficFromText(value) {
  const raw = text(value);
  const patterns = [
    /(?:浏览量|流量)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*([kKmM万]?)/,
    /(^|[\s，,。;；])(\d+(?:\.\d+)?)\s*([kKmM万])(?:\s*浏览量)?/,
    /(^|[\s，,。;；])(\d{4,})(?!\s*(?:刀|元|美元|\$|usd))/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const numberPart = Number(match[1] || match[2]);
    const unit = (match[2] && Number.isNaN(Number(match[2])) ? match[2] : match[3] || "").toLowerCase();
    if (!Number.isFinite(numberPart)) continue;
    let traffic = numberPart;
    if (unit === "k") traffic *= 1000;
    if (unit === "m") traffic *= 1000000;
    if (unit === "万") traffic *= 10000;
    return {
      value: Math.round(traffic),
      raw: match[0].trim(),
    };
  }

  return { value: null, raw: "" };
}

function hasNegativePaid(raw) {
  return /(无|没有|暂无|未见|没看到|不需要|无需|不用|无明显).{0,8}(付费|收费|价格|付款|广告|套餐|premium|paid)|无付费引导|无收费引导/i.test(raw);
}

function paidSignals(raw) {
  const signals = [];
  const checks = [
    ["收费", /收费|可收费|需收费|需要收费/],
    ["付费", /付费|付款|付钱/],
    ["价格/金额", /(?:\$|￥|¥)\s*\d+|\d+(?:\.\d+)?\s*(?:刀|美元|美金|元|usd|dollar)/i],
    ["付费广告/曝光", /广告位|推广|曝光|featured|sponsor|promotion|promote/i],
    ["付费套餐/升级", /套餐|高级|premium|paid|pricing|upgrade|pro plan|membership/i],
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(raw)) signals.push(label);
  }
  return signals;
}

function classifyPaid(raw) {
  const signals = paidSignals(raw);
  if (signals.length === 0) return { yes: false, reason: "" };
  if (hasNegativePaid(raw) && !/(?:\$|￥|¥)\s*\d+|\d+(?:\.\d+)?\s*(?:刀|美元|美金|元|usd|dollar)/i.test(raw)) {
    return { yes: false, reason: "备注中有“无付费/无收费”类否定表达" };
  }
  return { yes: true, reason: signals.join("、") };
}

function hasNegativeBacklink(raw) {
  return /(无|没有|暂无|未见|没看到|不需要|无需|不用|no).{0,10}(反链|反链接|互链|backlink|reciprocal|link back)/i.test(raw);
}

function backlinkSignals(raw) {
  const signals = [];
  const checks = [
    ["反链", /反链|反链接|反向链接|外链回链/],
    ["互链/回链", /互链|回链|link\s*back|linkback|return\s+link/i],
    ["英文 reciprocal/backlink", /backlink|reciprocal/i],
    ["要求挂链接", /需要.{0,12}(?:挂|加|放|添加|加入).{0,12}链接|(?:挂|加|放|添加|加入).{0,12}本站链接/],
  ];
  for (const [label, pattern] of checks) {
    if (pattern.test(raw)) signals.push(label);
  }
  return signals;
}

function classifyBacklink(raw) {
  const signals = backlinkSignals(raw);
  if (signals.length === 0 || hasNegativeBacklink(raw)) return { yes: false, reason: "" };
  return { yes: true, reason: signals.join("、") };
}

function formatTraffic(value) {
  if (value == null) return "";
  if (value >= 1000000) return `${(value / 1000000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(2).replace(/\.?0+$/, "")}K`;
  return String(value);
}

function sortByTrafficDesc(a, b) {
  return (b.trafficValue || 0) - (a.trafficValue || 0);
}

await fs.mkdir(outputDir, { recursive: true });

const input = await FileBlob.load(inputPath);
const sourceWorkbook = await SpreadsheetFile.importXlsx(input);
const sheet = sourceWorkbook.worksheets.getItemAt(0);
const values = sheet.getUsedRange(true).values;

const rows = values.slice(1).map((row, index) => {
  const domain = normalizeUrl(row[0]);
  const status = text(row[1]);
  const note = text(row[3]);
  const combined = `${text(row[0])} ${note}`;
  const traffic = trafficFromText(note || combined);
  const paid = classifyPaid(combined);
  const backlink = classifyBacklink(combined);
  return {
    sourceRow: index + 2,
    domain,
    status,
    note,
    trafficValue: traffic.value,
    trafficDisplay: formatTraffic(traffic.value),
    trafficRaw: traffic.raw,
    paid: paid.yes,
    paidReason: paid.reason,
    backlink: backlink.yes,
    backlinkReason: backlink.reason,
  };
}).filter((row) => row.domain);

const paidCandidates = rows
  .filter((row) => row.trafficValue != null && row.trafficValue > 10000 && row.paid)
  .sort(sortByTrafficDesc);

const backlinkRows = rows
  .filter((row) => row.backlink)
  .sort(sortByTrafficDesc);

const workbook = Workbook.create();
const paidSheet = workbook.worksheets.add("付费候选");
const backlinkSheet = workbook.worksheets.add("反链引导");
const rulesSheet = workbook.worksheets.add("判断规则");

const paidHeader = ["原表行号", "网站域名", "流量", "流量数值", "付费判断依据", "提交情况", "备注"];
const paidRows = paidCandidates.map((row) => [
  row.sourceRow,
  row.domain,
  row.trafficDisplay,
  row.trafficValue,
  row.paidReason,
  row.status,
  row.note,
]);

paidSheet.getRangeByIndexes(0, 0, paidRows.length + 1, paidHeader.length).values = [paidHeader, ...paidRows];

const backlinkHeader = ["原表行号", "网站域名", "流量", "流量数值", "反链判断依据", "提交情况", "备注"];
const backlinkData = backlinkRows.map((row) => [
  row.sourceRow,
  row.domain,
  row.trafficDisplay,
  row.trafficValue,
  row.backlinkReason,
  row.status,
  row.note,
]);

backlinkSheet.getRangeByIndexes(0, 0, backlinkData.length + 1, backlinkHeader.length).values = [backlinkHeader, ...backlinkData];

rulesSheet.getRange("A1:B9").values = [
  ["筛选目标", "流量高于 10K，且备注中出现付费/收费/价格/付费广告/套餐/升级等引导"],
  ["流量识别", "识别 28.22K、222k、1.2M、20万、10000 这类写法，并换算成数值"],
  ["付费正向词", "收费、付费、付款、刀、美元、$、广告位、推广、曝光、featured、premium、paid、pricing、upgrade、套餐等"],
  ["付费否定词", "无付费引导、无收费、没有付费、不需要付费等会被排除，除非同条备注同时出现明确价格"],
  ["反链正向词", "反链、反链接、反向链接、互链、backlink、reciprocal、link back、return link、要求挂本站链接等"],
  ["反链否定词", "无反链、不需要反链、no backlink required 等会被排除"],
  ["人工复核提醒", "备注不规范时可能存在边界情况，建议重点复核“判断依据”和原备注列"],
  ["源文件", inputPath],
  ["生成时间", new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })],
];

for (const targetSheet of [paidSheet, backlinkSheet]) {
  const used = targetSheet.getUsedRange(true);
  used.format.font = { name: "Arial", size: 10 };
  targetSheet.getRange("A1:G1").format = {
    fill: "#1F4E78",
    font: { bold: true, color: "#FFFFFF" },
  };
  targetSheet.getRange("A:G").format.wrapText = true;
  targetSheet.getRange("A:A").format.columnWidth = 10;
  targetSheet.getRange("B:B").format.columnWidth = 46;
  targetSheet.getRange("C:C").format.columnWidth = 12;
  targetSheet.getRange("D:D").format.columnWidth = 12;
  targetSheet.getRange("E:E").format.columnWidth = 22;
  targetSheet.getRange("F:F").format.columnWidth = 12;
  targetSheet.getRange("G:G").format.columnWidth = 72;
  targetSheet.freezePanes.freezeRows(1);
}

rulesSheet.getRange("A1:B9").format.font = { name: "Arial", size: 10 };
rulesSheet.getRange("A1:A9").format = {
  fill: "#E2F0D9",
  font: { bold: true },
};
rulesSheet.getRange("A:A").format.columnWidth = 18;
rulesSheet.getRange("B:B").format.columnWidth = 95;
rulesSheet.getRange("B:B").format.wrapText = true;

await fs.writeFile(`${outputDir}/paid-candidates.json`, JSON.stringify(paidCandidates, null, 2), "utf8");
await fs.writeFile(`${outputDir}/backlink-rows.json`, JSON.stringify(backlinkRows, null, 2), "utf8");

const preview = await workbook.render({
  sheetName: "付费候选",
  range: `A1:G${Math.min(paidCandidates.length + 1, 25)}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(`${outputDir}/preview-paid.png`, new Uint8Array(await preview.arrayBuffer()));

const check = await workbook.inspect({
  kind: "table",
  sheetId: "付费候选",
  range: `A1:G${Math.min(paidCandidates.length + 1, 20)}`,
  include: "values",
  tableMaxRows: 20,
  tableMaxCols: 7,
  tableMaxCellChars: 180,
});
console.log(check.ndjson);

const backlinkCheck = await workbook.inspect({
  kind: "table",
  sheetId: "反链引导",
  range: `A1:G${Math.min(backlinkRows.length + 1, 20)}`,
  include: "values",
  tableMaxRows: 20,
  tableMaxCols: 7,
  tableMaxCellChars: 180,
});
console.log(backlinkCheck.ndjson);

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  sourceRows: rows.length,
  paidCandidateCount: paidCandidates.length,
  backlinkCount: backlinkRows.length,
  topPaid: paidCandidates.slice(0, 10).map((row) => ({
    row: row.sourceRow,
    domain: row.domain,
    traffic: row.trafficDisplay,
    reason: row.paidReason,
  })),
  backlinks: backlinkRows.slice(0, 10).map((row) => ({
    row: row.sourceRow,
    domain: row.domain,
    traffic: row.trafficDisplay,
    reason: row.backlinkReason,
  })),
}, null, 2));
