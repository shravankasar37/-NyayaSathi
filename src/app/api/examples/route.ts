// Which examples have a recorded run, so the UI can offer replay for them.
import { EXAMPLES } from "@/lib/examples";
import { recordedIds } from "@/lib/recordings";

export const runtime = "nodejs";

export async function GET() {
  const recorded = new Set(recordedIds());
  return Response.json(EXAMPLES.map((e) => ({ ...e, recorded: recorded.has(e.id) })));
}
