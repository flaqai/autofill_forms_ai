import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "/Users/ai6677/Downloads/29/实验表格.xlsx";

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 8000,
  tableMaxRows: 12,
  tableMaxCols: 10,
  tableMaxCellChars: 180,
});

console.log(summary.ndjson);

const sheet = workbook.worksheets.getItemAt(0);
const usedRange = sheet.getUsedRange(true);
const values = usedRange.values;

await fs.writeFile(
  "/Users/ai6677/Documents/GitHub/autofill_forms_ai/outputs/link-screening/raw-values.json",
  JSON.stringify(values, null, 2),
  "utf8",
);

console.log(JSON.stringify({
  sheetName: sheet.name,
  rowCount: values.length,
  colCount: values[0]?.length ?? 0,
  sample: values.slice(0, 20).map((row) => row.slice(0, 8)),
}, null, 2));
