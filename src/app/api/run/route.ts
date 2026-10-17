// Runs the agent pipeline and streams its trace to the browser as server-sent events.
import { runPipeline, type TraceEvent } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const { story, answers } = (await req.json()) as { story?: string; answers?: string };
  if (!story || story.trim().length < 15) return Response.json({ error: "Describe your problem in a sentence or two." }, { status: 400 });
  if (story.length > 4000) return Response.json({ error: "Please keep the description under 4000 characters." }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: TraceEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      try {
        await runPipeline(story.trim(), emit, answers?.trim() || undefined);
      } catch (err) {
        console.error(err);
        emit({ type: "error", message: err instanceof Error ? err.message : "Something went wrong" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
