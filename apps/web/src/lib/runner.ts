// Client-side helper for the VHPCE gateway, shared by the Flagship (bench jobs) and the
// Playground (code jobs). The gateway is async: POST /api/jobs returns a job id (or, for a
// cached bench, the result directly); GET /api/jobs/{id} is polled until the worker finishes.
// runJob resolves with the same result object the old /run and /run-code endpoints returned,
// so callers feed it straight into the ProfileResult seam.

export const API = process.env.NEXT_PUBLIC_VHPCE_API || "http://localhost:8000";

export type JobBody =
  | { kind: "bench"; exp: string; variant: string; maxthreads: number }
  | { kind: "code"; source: string; threads?: number[]; reps?: number; profile?: boolean }
  | { kind: "mpi"; variant: string; maxranks: number }
  | { kind: "cuda"; variant: string };

export type Phase = "queued" | "running";

type Health = { ok?: boolean; redis?: boolean; docker?: string | null; cores?: number };
type SubmitResp = { id: string | null; status: string; result?: unknown; cached?: boolean };
type PollResp = { id: string; status: string; result?: unknown };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const POLL_MS = 700;
const MAX_WAIT_MS = 6 * 60 * 1000;

export async function health(): Promise<Health> {
  const r = await fetch(API + "/api/health", { cache: "no-store" });
  return r.json();
}

// Submit a job and resolve with the runner's result object. Polls until done. `onStatus`
// fires once per queued→running transition; `signal` aborts the fetches and stops polling.
export async function runJob(
  body: JobBody,
  opts: { signal?: AbortSignal; onStatus?: (p: Phase) => void } = {},
): Promise<unknown> {
  const { signal, onStatus } = opts;
  const sub: SubmitResp = await fetch(API + "/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }).then((r) => r.json());

  if (sub.status === "done") return sub.result;          // cached bench — no polling
  if (sub.status === "error") return sub.result;         // validation rejection
  if (!sub.id) throw new Error("gateway did not return a job id");

  onStatus?.("queued");
  let last: Phase = "queued";
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    await sleep(POLL_MS);
    const st: PollResp = await fetch(`${API}/api/jobs/${sub.id}`, { cache: "no-store", signal }).then((r) => r.json());
    if (st.status === "done") return st.result;
    if (st.status === "error") return st.result ?? { error: "run", message: "job failed" };
    if (st.status === "not_found") throw new Error("job not found — is the worker running?");
    if (st.status === "running" && last !== "running") { onStatus?.("running"); last = "running"; }
  }
  throw new Error("timed out waiting for the gateway");
}
