"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Models, Measured, runnerSpec, EXPERIMENTS, MAXP, TRIAD_AI } from "@vhpce/perf-models";
import { ExplainMeasured } from "@vhpce/explain";
import { drawOverlay } from "@vhpce/viz";
import { fmt, type RunnerData, type SweepPoint } from "@vhpce/profile-schema";
import { health, runJob, type JobBody } from "../lib/runner";

type ExpId = "falseSharing" | "synchronization" | "bandwidth" | "imbalance" | "mpiHalo" | "cuda" | "cudaCoalesce" | "cudaDivergence" | "cudaAtomics";
type Params = Record<string, number | string | boolean>;

// Same kernel for both producers: bandwidth's model AI is pinned to the real triad so the model
// describes the exact kernel the gateway runs.
const DEFAULT_PARAMS: Record<ExpId, Params> = {
  falseSharing: { threads: 24, padded: false, intensity: 1 },
  synchronization: { threads: 24, mode: "critical" },
  bandwidth: { threads: 24, ai: TRIAD_AI },
  imbalance: { threads: 24, sched: "static" },
  mpiHalo: { ranks: 24, mode: "strong" },
  cuda: { blockSize: 256, variant: "heavy" },
  cudaCoalesce: { stride: 8 },
  cudaDivergence: { paths: 8 },
  cudaAtomics: { targets: 1 },
};

// The scenario knob that reshapes the curve (and so the divergence) for each experiment.
const SCENARIO: Partial<Record<ExpId, { key: string; opts: [string | boolean, string][] }>> = {
  falseSharing: { key: "padded", opts: [[false, "shared"], [true, "padded"]] },
  synchronization: { key: "mode", opts: [["critical", "critical"], ["atomic", "atomic"], ["reduction", "reduction"]] },
  imbalance: { key: "sched", opts: [["static", "static"], ["guided", "guided"], ["dynamic", "dynamic"]] },
  mpiHalo: { key: "mode", opts: [["strong", "strong"], ["weak", "weak"]] },
  cuda: { key: "variant", opts: [["heavy", "heavy"], ["light", "light"]] },
};

// What the analytical model leaves out — the reason the two curves part ways. This is the payoff.
const MODEL_GAP: Record<ExpId, string> = {
  falseSharing: "The model charges a fixed coherence penalty per shared write; on real cores the ping-pong cost depends on the cache topology and the prefetcher, so the measured curve wanders around the prediction.",
  synchronization: "The serial-fraction model assumes a fixed per-thread cost. Real runs add lock contention (critical/atomic) AND memory-bandwidth limits — even lock-free reduction saturates the bus — so the measured curve bends away from the prediction as cores rise.",
  bandwidth: "The roofline assumes one hard DRAM ceiling. The measured triad reveals the attainable bandwidth (well below peak) and the real saturation point where extra threads stop helping.",
  imbalance: "The model uses idealized chunk costs; measured scheduling overhead and runtime jitter shift the dynamic/guided curves, especially at high thread counts.",
  mpiHalo: "On a single node MPI exchanges halos through shared memory, so the measured communication wall is far gentler than the model's network-cost assumption — the silicon beats the model here.",
  cuda: "Occupancy is modelled purely from register/block resource limits; the measured value also reflects the launch configuration and how the scheduler actually packs warps.",
  cudaCoalesce: "The model assumes efficiency = 1/stride. The L2 cache softens the penalty at small strides, so the silicon BEATS the napkin model there — the gap is the cache doing you a favour.",
  cudaDivergence: "The model predicts 1/paths. Measured warp replay tracks it almost exactly — a case where the simple model nails reality, and the near-zero gap is itself the lesson.",
  cudaAtomics: "The model assumes contention falls smoothly as 1/(1+C/targets). Real atomic hardware has its own queueing and L2 behaviour, so the measured curve drops faster at first and plateaus once the atomic units saturate — the gap is the hardware's contention handling.",
};

function jobFor(exp: ExpId, cp: Params): { key: string; body: JobBody } {
  const isMpi = exp === "mpiHalo", isCuda = exp === "cuda";
  const isCoalesce = exp === "cudaCoalesce", isDiverge = exp === "cudaDivergence", isAtomics = exp === "cudaAtomics";
  const cudaExp = isDiverge ? "divergence" : isCoalesce ? "coalesce" : isAtomics ? "atomics" : "occupancy";
  const { bexp, variant } = runnerSpec(exp, cp);
  const key = isDiverge ? "cuda/divergence" : isCoalesce ? "cuda/coalesce" : isAtomics ? "cuda/atomics"
    : isCuda ? "cuda/" + cp.variant : isMpi ? "mpi/" + cp.mode : bexp + "/" + variant;
  const body: JobBody = (isCuda || isCoalesce || isDiverge || isAtomics)
    ? { kind: "cuda", experiment: cudaExp, variant: (cp.variant as string) ?? "heavy" }
    : isMpi
      ? { kind: "mpi", variant: cp.mode as string, maxranks: MAXP }
      : { kind: "bench", exp: bexp, variant, maxthreads: MAXP };
  return { key, body };
}

export default function Compare() {
  const [exp, setExp] = useState<ExpId>("cudaCoalesce");
  const [params, setParams] = useState<Record<ExpId, Params>>(DEFAULT_PARAMS);
  const [fetched, setFetched] = useState<Record<string, RunnerData>>({});
  const [errKey, setErrKey] = useState<string | null>(null);
  const [runnerOk, setRunnerOk] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const inflightRef = useRef<Set<string>>(new Set());

  const cp = params[exp];
  const model = useMemo(() => Models[exp](cp), [exp, cp]);
  const { key, body } = useMemo(() => jobFor(exp, cp), [exp, cp]);

  // measured + loading are DERIVED from cached state — never set synchronously in an effect.
  const cachedData = fetched[key];
  const measured = useMemo(
    () => (runnerOk && cachedData ? Measured[exp](cp, cachedData) : null),
    [runnerOk, cachedData, exp, cp],
  );
  const failed = errKey === key;
  const loading = runnerOk && !cachedData && !failed;

  const setParam = useCallback(
    (patch: Params) => setParams((prev) => ({ ...prev, [exp]: { ...prev[exp], ...patch } })),
    [exp],
  );

  useEffect(() => {
    let alive = true;
    health().then((j) => { if (alive && j?.ok) setRunnerOk(true); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Fetch the measured twin for the current scenario; setState happens only in async callbacks.
  useEffect(() => {
    if (!runnerOk || fetched[key] || errKey === key || inflightRef.current.has(key)) return;
    inflightRef.current.add(key);
    let alive = true;
    runJob(body)
      .then((data) => {
        const d = data as RunnerData & { error?: string; message?: string };
        if (!alive) return;
        if (!d || d.error) { setErrKey(key); return; }
        setFetched((prev) => ({ ...prev, [key]: d }));
      })
      .catch(() => { if (alive) setErrKey(key); })
      .finally(() => { inflightRef.current.delete(key); });
    return () => { alive = false; };
  }, [key, body, runnerOk, fetched, errKey]);

  // Draw + redraw on data/resize change (fresh closure each change — no refs during render).
  useEffect(() => {
    const draw = () => { if (svgRef.current) drawOverlay(svgRef.current, model, measured); };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [model, measured]);

  const meta = EXPERIMENTS.find((e) => e.id === exp)!;
  const scenario = SCENARIO[exp];

  // Divergence between the two curves (occupancy if present, else efficiency), over shared x.
  const useOcc = model.sweep.some((p) => p.occ != null);
  const div = useMemo(() => {
    if (!measured) return null;
    const yPick = (p: SweepPoint) => (useOcc ? (p.occ ?? p.efficiency) : p.efficiency);
    const byX = new Map(measured.sweep.map((p) => [p.x, yPick(p)]));
    const gaps = model.sweep.filter((p) => byX.has(p.x)).map((p) => ({ x: p.x, g: Math.abs(yPick(p) - byX.get(p.x)!) }));
    if (!gaps.length) return null;
    const max = gaps.reduce((a, b) => (b.g > a.g ? b : a));
    const mean = gaps.reduce((s, b) => s + b.g, 0) / gaps.length;
    return { max, mean };
  }, [model, measured, useOcc]);

  const expl = measured ? ExplainMeasured[exp](measured) : null;

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Same Kernel,</span> Every Model</h1>
          <div className="sub">One experiment, both producers at once — the analytical model vs the measured run, and the gap between them.</div>
        </div>
        <div className="src-badge">
          <span style={{ marginRight: 2 }}>twin:</span>
          <span className="pill sel"><span className="dot" style={{ background: "var(--accent2)" }} />Model</span>
          <span className={"pill " + (runnerOk ? "sel" : "disabled")} title={runnerOk ? "live gateway" : "gateway offline — model only"}>
            <span className="dot" style={{ background: "var(--accent)" }} />{runnerOk ? "Measured" : "Measured · offline"}
          </span>
        </div>
      </header>

      {failed && (
        <div className="banner">Runner error for this scenario — showing the model only.{" "}
          <a style={{ cursor: "pointer" }} onClick={() => setErrKey(null)}>retry</a>
        </div>
      )}

      <nav className="tabs">
        {EXPERIMENTS.map((e, i) => (
          <button key={e.id} className={"tab" + (e.id === exp ? " active" : "")} onClick={() => setExp(e.id as ExpId)}>
            <span className="ix">0{i + 1}</span>{e.name}
          </button>
        ))}
      </nav>

      <div className="grid">
        <section className="card">
          <h2>Scenario</h2>
          {scenario ? (
            <div className="ctrl">
              <label>{meta.name}</label>
              <div className="seg fix">
                {scenario.opts.map(([v, lab]) => (
                  <button key={String(v)} className={cp[scenario.key] === v ? "on" : ""} onClick={() => setParam({ [scenario.key]: v })}>{lab}</button>
                ))}
              </div>
              <div className="fixhint">Change the scenario and watch the model and the silicon agree — or part ways.</div>
            </div>
          ) : (
            <div className="ctrl"><div className="fixhint">{meta.name} sweeps the whole range in one run — the sweep itself is the story. Model is the dashed line; the measured run is solid.</div></div>
          )}
          <div style={{ marginTop: 14 }}>
            <div className="metric"><span className="k">producer A</span><span className="v" style={{ color: "var(--accent2)" }}>model (dashed)</span></div>
            <div className="metric"><span className="k">producer B</span><span className="v" style={{ color: "var(--accent)" }}>{loading ? "measuring…" : runnerOk ? "measured (solid)" : "offline"}</span></div>
            <div className="metric"><span className="k">y-axis</span><span className="v">{useOcc ? "occupancy" : "efficiency"}</span></div>
          </div>
        </section>

        <section className="card vizwrap">
          <h2><span>Model vs Measured</span><span className="scene-tag">{meta.scene}</span></h2>
          <div className="chart" style={{ flex: 1, minHeight: 320 }}>
            <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
            <div className="legend">
              <span><i style={{ borderColor: "var(--accent2)", borderStyle: "dashed" }} />model</span>
              <span><i style={{ borderColor: "var(--accent)" }} />measured</span>
              <span><i style={{ background: "rgba(255,180,84,.4)", border: "none" }} />divergence</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Divergence</h2>
          <div className="hero">
            <div className="big" style={{ color: div ? (div.max.g > 0.25 ? "var(--bad)" : div.max.g > 0.08 ? "var(--warn)" : "var(--good)") : "var(--muted)" }}>
              {loading ? "•••" : div ? fmt(div.max.g * 100, 0) + "%" : "—"}
            </div>
            <div className="cap">{div ? `largest model↔silicon gap (at x = ${div.max.x})` : runnerOk ? "select a scenario" : "gateway offline — model only"}</div>
          </div>
          {div && (
            <div className="metric"><span className="k">average gap</span><span className="v">{fmt(div.mean * 100, 1)}%</span></div>
          )}
        </section>
      </div>

      <div className="lower">
        <section className="card explain">
          <h2>What the model leaves out</h2>
          <div className="blocks">
            <div className="eb why">
              <div className="t">Where the napkin model breaks</div>
              <div className="body">{MODEL_GAP[exp]}</div>
            </div>
            {expl && (
              <div className="eb what">
                <div className="t">Measured finding</div>
                <div className="body" dangerouslySetInnerHTML={{ __html: expl.what }} />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
