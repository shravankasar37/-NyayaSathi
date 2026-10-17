import { buildDocx } from "@/lib/docx";
import type { Result } from "@/lib/agents";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const result = (await req.json()) as Result;
  if (!result?.draft?.body) return Response.json({ error: "No draft to export" }, { status: 400 });
  const buf = await buildDocx(result);
  const name = result.draft.documentTitle.replace(/[^\w\- ]+/g, "").slice(0, 60).trim().replace(/\s+/g, "_") || "NyayaSathi";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${name}.docx"`,
    },
  });
}
