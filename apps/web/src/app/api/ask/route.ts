import Anthropic from "@anthropic-ai/sdk";

/**
 * "Ask the AI" — the optional live-LLM half of the "Both" design (docs/05).
 * The deterministic explainer is always on in the UI; this endpoint adds a
 * conversational layer GROUNDED on the deterministic findings (passed in `summary`)
 * so the model explains/extends them rather than inventing competing numbers.
 *
 * Key resolution: per-request `x-anthropic-key` header (self-host / bring-your-own)
 * OR server-side ANTHROPIC_API_KEY. Never logged, never persisted.
 */

const MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You are the HPC tutor inside "Visual HPC for Engineers", an interactive performance laboratory. The student is looking at one parallel-performance experiment (false sharing, synchronization overhead, memory-bandwidth saturation, or load imbalance) and has a question.

You will be given a GROUND-TRUTH block: the experiment, the current parameters, the measured/modeled metrics, and a deterministic finding (what happened / why / how to fix / expected gain). These numbers are authoritative — they were computed, not generated. Build your answer on them. Never contradict them or invent different figures; if the student asks something the block doesn't cover, reason from HPC fundamentals and say what you're assuming.

Teaching style:
- Answer directly and concisely (a short paragraph or a few bullets). No preamble, no "Great question", no meta-commentary about your reasoning.
- Explain the *why* at the level of hardware: cache lines and the coherence protocol, the memory bus and arithmetic intensity, Amdahl's law and serial fractions, scheduling and load balance.
- Connect cause to the numbers on screen ("efficiency is 31% because…").
- When relevant, give a concrete next experiment the student can try with the on-screen controls.
- Plain text and simple Markdown only. No LaTeX, no images.

Core concepts you can lean on: cache coherence (MESI) and false sharing; cache-line padding/alignment; critical sections, atomics, and reductions; Amdahl's vs Gustafson's law; the roofline model, arithmetic intensity, and the memory/compute ridge; STREAM-triad bandwidth saturation; OpenMP static/dynamic/guided scheduling and load imbalance; strong vs weak scaling; speedup and efficiency.`;

export function GET() {
  return Response.json({ configured: !!process.env.ANTHROPIC_API_KEY, model: MODEL });
}

export async function POST(req: Request) {
  const headerKey = req.headers.get("x-anthropic-key")?.trim();
  const apiKey = headerKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "no_key" }, { status: 400 });
  }

  let body: { summary?: string; question?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const question = (body.question || "").trim();
  if (!question) return Response.json({ error: "no_question" }, { status: 400 });
  const summary = (body.summary || "").slice(0, 4000);

  const userContent =
    `GROUND TRUTH (authoritative — build your answer on this):\n${summary}\n\n` +
    `Student question: ${question}`;

  const client = new Anthropic({ apiKey });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const llm = client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          thinking: { type: "disabled" },
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
          ],
          messages: [{ role: "user", content: userContent }],
        });
        for await (const event of llm) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String((e as Error)?.message || e);
        controller.enqueue(encoder.encode(`\n\n[AI error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
