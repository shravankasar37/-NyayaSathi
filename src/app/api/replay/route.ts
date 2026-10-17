// Streams a recorded run in the same server-sent-event format as /api/run, with its pauses compressed
// so the whole replay takes about ten seconds.
import { loadRecording } from "@/lib/recordings";

export const runtime = "nodejs";

const TARGET_MS = 10_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const rec = loadRecording(id);
  if (!rec) return Response.json({ error: "No recording for this example" }, { status: 404 });

  const scale = Math.min(1, TARGET_MS / Math.max(1, rec.totalMs));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      send({ type: "replay", recordedAt: rec.recordedAt, models: rec.models, totalMs: rec.totalMs });
      let prev = 0;
      for (const { t, event } of rec.events) {
        await sleep(Math.min(2_500, (t - prev) * scale));
        prev = t;
        send(event);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
}
