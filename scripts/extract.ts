// Extracts plain text from each bare-act PDF in corpus/raw into corpus/text/<id>.txt
import { readFileSync, writeFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

const ACTS = ["bns_prs", "bnss_prs", "cpa", "rti", "it"];
for (const id of ACTS) {
  const parser = new PDFParse({ data: readFileSync(`corpus/raw/${id}.pdf`) });
  const { text, total } = await parser.getText();
  await parser.destroy();
  writeFileSync(`corpus/text/${id.replace("_prs", "")}.txt`, text);
  console.log(`${id}: ${total} pages, ${text.length} chars`);
}
