# 05 — AI Explanation Layer ("Both")

Decision: **Both** — an always-on deterministic explainer plus an optional live-LLM panel.
They cooperate; the deterministic layer grounds the LLM.

## 1. Why two layers

| | Deterministic (`packages/explain`) | LLM panel (`services/ai`) |
|---|---|---|
| Availability | Always, offline, no key | Only when a key is configured |
| Cost | Free | Per token |
| Output | Structured, reproducible, exact numbers | Conversational, handles follow-ups |
| Risk | None (computed) | Hallucination — mitigated by grounding |
| Role | The default explanation under every experiment | "Ask the AI" for *why deeper / what if* |

The deterministic layer is not a fallback — it's the primary teaching voice. The LLM extends
it for open-ended questions ("why does tiling help here?", "what if I had 64 cores?").

## 2. Deterministic explainer

Pure function: `explain(result: ProfileResult, context: ExperimentContext) → Explanation[]`.

It runs ordered **rule checks** over the `ProfileResult`. Each rule has a guard and emits a
structured finding when triggered:

```ts
interface Explanation {
  severity: "info" | "warn" | "critical";
  what: string;     // observed symptom, with the actual number
  why: string;      // mechanism, naming the HPC concept
  how: string;      // concrete fix
  expectedGain: string; // quantified from the model ("~3.4× toward ideal")
  evidence: Array<{ metric: string; value: number; threshold: number }>;
}
```

Example rule (memory-bound saturation):

```
IF efficiency(p_max) < 0.7
   AND bandwidth_utilization(p_max) > 0.9
   AND arithmetic_intensity < ridge_AI
THEN emit {
  what: "Speedup flatlines after ~3 threads (efficiency 41% at 8).",
  why:  "Kernel is memory-bound; DRAM bandwidth is ~94% saturated, so added
         threads contend for the same bus rather than doing new work.",
  how:  "Raise arithmetic intensity (cache blocking / loop fusion) or cut traffic.",
  expectedGain: "Operating point moves toward the compute ceiling; >2× headroom.",
  evidence: [{metric:"efficiency@8",value:0.41,threshold:0.7}, ...]
}
```

Findings map 1:1 to the experiments' "what/why/how/expected" panels. They are deterministic
given the same `ProfileResult`, so lessons are reproducible and testable.

## 3. LLM panel (`services/ai`)

- **Provider:** Anthropic Claude via the official SDK, behind an `LLMProvider` interface so it
  is swappable (the blueprint lists Claude/GPT/DeepSeek/local).
- **Prompt structure** (profiler-aware prompting):
  - *System* (static, **prompt-cached**): the HPC-tutor persona + teaching guidelines +
    glossary of concepts. This is large and fixed → caching cuts cost dramatically.
  - *Context* (per request): a compact `ProfileResult` summary **plus the deterministic
    findings** as ground truth, plus the experiment id.
  - *User*: the student's question.
- **Grounding:** the deterministic findings are injected as authoritative. The system prompt
  instructs the model to explain and extend them, not to invent competing numbers. This is the
  single biggest hallucination control.
- **Streaming:** responses stream to the panel.
- **Caching:** identical (result-hash + question) pairs are cached in Redis to avoid re-billing
  common questions.

## 4. Key handling & privacy

- No key shipped or required. Without one, the panel shows: *"Live AI is off — built-in
  explanations are active. Add a key to ask follow-ups."*
- Key supplied via server-side env (`ANTHROPIC_API_KEY`) for hosted deployments, or a
  per-session client-supplied key for self-hosters. Keys are never logged or persisted to
  Postgres.
- Only the `ProfileResult` summary + findings + question are sent — never the student's
  account data. For model-sourced results this is fully synthetic data anyway.

## 5. Roadmap fit

- **P0:** deterministic explanations only (inlined). Establishes the `Explanation` shape.
- **P1:** `packages/explain` formalized + the optional LLM panel wired in `apps/web`.
- **P2+:** the same explainer now also runs over **measured** `ProfileResult`s — the rules
  don't care whether the data was modeled or measured, which is the whole point of the seam.
