"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { archetypes } from "./reference/archetypes";
import { ENTRIES, TECHS, type RefEntry, type Tech } from "./reference/entries";
import { GLOSSARY_KEYS } from "./glossary";
import Term from "./Term";

type Filter = "All" | Tech;

const byId = (id: string) => ENTRIES.find((e) => e.id === id);

export default function Reference() {
  const [filter, setFilter] = useState<Filter>("All");
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string>(ENTRIES[0].id);

  // Deep-link: /reference?id=<entryId>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional URL sync on mount (SSR-safe)
    if (id && byId(id)) setSelId(id);
  }, []);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      ENTRIES.filter((e) => filter === "All" || e.tech === filter).filter((e) => {
        if (!query) return true;
        return (`${e.name} ${e.summary} ${e.category} ${e.signature} ${e.note ?? ""}`).toLowerCase().includes(query);
      }),
    [filter, query],
  );

  // group filtered entries by category, preserving entry order
  const groups = useMemo(() => {
    const g: Record<string, RefEntry[]> = {};
    for (const e of filtered) (g[`${e.tech} · ${e.category}`] ||= []).push(e);
    return g;
  }, [filtered]);

  // Prefer the selected entry, but if a filter/search hid it, fall back to the first visible one.
  const sel = filtered.find((e) => e.id === selId) ?? filtered[0] ?? ENTRIES[0];
  // Jump to any entry (e.g. a cross-tech "related" link) by clearing filters first.
  const goTo = (id: string) => { setFilter("All"); setQ(""); setSelId(id); };
  const selRef = useRef(sel);
  useEffect(() => { selRef.current = sel; });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let w = 0, h = 0, raf = 0;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const resize = () => {
      const rect = cv.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, rect.width * dpr); cv.height = Math.max(1, rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); w = rect.width; h = rect.height;
    };
    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const e = selRef.current;
      archetypes[e.visual.archetype]?.(ctx, w, h, now, e.visual.params ?? {});
    };
    resize();
    window.addEventListener("resize", resize);
    if (!reduce) { const loop = (now: number) => { draw(now); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }
    else draw(0);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  // reduced-motion: redraw on selection change
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!reduce) return;
    const cv = canvasRef.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const rect = cv.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    archetypes[sel.visual.archetype]?.(ctx, rect.width, rect.height, 0, sel.visual.params ?? {});
  }, [sel]);

  // contextual glossary terms: glossary keys that appear in this entry's text
  const haystack = `${sel.name} ${sel.summary} ${sel.note ?? ""} ${sel.category}`.toLowerCase();
  const terms = GLOSSARY_KEYS.filter((k) => haystack.includes(k)).slice(0, 6);

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Command</span> Reference</h1>
          <div className="sub">Every OpenMP &amp; MPI directive, visualized. Search, hover a term, or <Link href="/learn">start with the basics →</Link></div>
        </div>
      </header>

      <div className="ref-bar">
        <input className="ref-search" type="text" placeholder="Search directives… (e.g. scatter, reduction, barrier)"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {(["All", ...TECHS] as Filter[]).map((t) => (
            <button key={t} className={filter === t ? "on" : ""} onClick={() => setFilter(t)}>{t}</button>
          ))}
        </div>
      </div>

      <div className="ref-grid">
        <aside className="card ref-list">
          {Object.keys(groups).length === 0 && <div className="pg-hint">No matches.</div>}
          {Object.entries(groups).map(([cat, items]) => (
            <div key={cat} className="ref-cat">
              <div className="ref-cat-h">{cat}</div>
              {items.map((e) => (
                <button key={e.id} className={"ref-item" + (e.id === sel.id ? " sel" : "")} onClick={() => setSelId(e.id)}>
                  <span className="ref-item-name">{e.name}</span>
                  <span className={"ref-tech " + e.tech.toLowerCase()}>{e.tech}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <section className="card ref-detail">
          <div className="ref-detail-head">
            <h2 style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: 16, color: "var(--text)" }}>{sel.name}</h2>
            <span className={"ref-tech " + sel.tech.toLowerCase()}>{sel.tech}</span>
            <span className="ref-cat-tag">{sel.category}</span>
          </div>
          <pre className="code ref-sig">{sel.signature.split("\n").map((ln, i) => <div className="ln" key={i}>{ln || " "}</div>)}</pre>
          <p className="ref-summary">{sel.summary}</p>
          <div className="ref-canvas"><canvas className="viz" ref={canvasRef} /></div>
          {sel.note && (
            <div className="eb how" style={{ marginTop: 12 }}>
              <div className="t">Good to know</div>
              <div className="body">{sel.note}</div>
            </div>
          )}
          <div className="ref-actions">
            {sel.exampleId && <Link className="learn-link" href={`/playground?ex=${sel.exampleId}`}>▶ Run it in the Playground</Link>}
          </div>
          {terms.length > 0 && (
            <div className="ref-terms">
              <span className="ref-terms-label">terms:</span>
              {terms.map((k) => <Term key={k} k={k} />)}
            </div>
          )}
          {sel.related && sel.related.length > 0 && (
            <div className="ref-related">
              <span className="ref-terms-label">related:</span>
              {sel.related.map((rid) => { const r = byId(rid); return r ? (
                <button key={rid} className="ref-chip" onClick={() => goTo(rid)}>{r.name}</button>
              ) : null; })}
            </div>
          )}
        </section>
      </div>

      <footer className="note">
        Conceptual animations to build intuition — every entry maps to a reusable visual <b>archetype</b>, so the
        library grows by adding data. Want the guided tour instead? See <Link href="/learn">Learn the Basics</Link>.
        Ready to measure? The <Link href="/">Flagship</Link> runs real OpenMP/MPI/GPU experiments. <i>OpenACC next.</i>
      </footer>
    </main>
  );
}
