// Builds a Word document from a verified draft: citation markers become "section N of <Act>",
// and the cited sections plus the computed deadlines are appended for the reader.
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { getSection } from "./corpus";
import type { Result } from "./agents";

const MARKER = /\[\[([A-Z]+-\d+[A-Z]{0,2})\]\]/g;
export const inlineCitation = (id: string) => {
  const s = getSection(id);
  return s ? `section ${s.section} of the ${s.actName}` : id;
};
export const resolveMarkers = (text: string) => text.replace(MARKER, (_, id: string) => inlineCitation(id));

function runs(line: string): TextRun[] {
  // **bold** spans; everything else plain
  return line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
    part.startsWith("**") && part.endsWith("**") ? new TextRun({ text: part.slice(2, -2), bold: true }) : new TextRun(part),
  );
}

function paragraphs(markdown: string): Paragraph[] {
  return resolveMarkers(markdown)
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trimEnd();
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      if (h) return new Paragraph({ heading: h[1].length === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: runs(h[2]) });
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) return new Paragraph({ bullet: { level: 0 }, children: runs(bullet[1]) });
      return new Paragraph({ children: runs(line), spacing: { after: 120 } });
    });
}

export async function buildDocx(r: Result): Promise<Buffer> {
  const doc = new Document({
    creator: "NyayaSathi",
    title: r.draft.documentTitle,
    styles: { default: { document: { run: { font: "Calibri", size: 23 } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun(r.draft.documentTitle)] }),
          ...paragraphs(r.draft.body),
        ],
      },
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("For your reference (do not file this page)")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Deadlines and where to file")] }),
          ...r.rules.map((x) => new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: `${x.label}: `, bold: true }), new TextRun(x.value)] })),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Law relied on")] }),
          ...r.selected.flatMap((s) => [
            new Paragraph({ children: [new TextRun({ text: s.label, bold: true }), new TextRun(` - ${s.why}`)] }),
            new Paragraph({ children: [new TextRun({ text: s.text.slice(0, 1500), size: 19, color: "444444" })], spacing: { after: 200 } }),
          ]),
          new Paragraph({ children: [new TextRun({ text: r.disclaimer, italics: true, size: 19 })] }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
