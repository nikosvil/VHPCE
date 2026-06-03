"use client";

import { useEffect, useRef, useState } from "react";

const SUGGESTIONS = [
  "Why does adding threads stop helping here?",
  "What's the hardware reason behind this?",
  "How would the fix change these numbers?",
];

export default function AskAI({
  context,
}: {
  context: { experimentId: string; mode: string; summary: string };
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const k = sessionStorage.getItem("vhpce_anthropic_key");
      if (k) setApiKey(k);
    } catch {}
    fetch("/api/ask")
      .then((r) => r.json())
      .then((j) => setConfigured(!!j.configured))
      .catch(() => setConfigured(false));
  }, []);

  const haveAccess = configured === true || !!apiKey;

  async function ask(q: string) {
    const qq = q.trim();
    if (!qq || streaming) return;
    setQuestion(qq);
    setAnswer("");
    setStreaming(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-anthropic-key"] = apiKey;
      const res = await fetch("/api/ask", {
        method: "POST",
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          experimentId: context.experimentId,
          mode: context.mode,
          summary: context.summary,
          question: qq,
        }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        setAnswer(j.error === "no_key" ? "No API key configured." : `Request failed: ${j.error || res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((a) => a + dec.decode(value, { stream: true }));
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      if (err?.name !== "AbortError") setAnswer((a) => a + `\n\n[error: ${err?.message || e}]`);
    } finally {
      setStreaming(false);
    }
  }

  function saveKey() {
    const k = keyDraft.trim();
    if (!k) return;
    setApiKey(k);
    try {
      sessionStorage.setItem("vhpce_anthropic_key", k);
    } catch {}
    setKeyDraft("");
  }

  return (
    <section className="card askai">
      <h2>Ask the AI <span className="askai-sub">grounded on the findings above</span></h2>

      {configured === null ? (
        <div className="askai-note">Checking for a model connection…</div>
      ) : !haveAccess ? (
        <div className="askai-note">
          Built-in explanations are always on. To ask follow-up questions, add an Anthropic API key
          (kept only in this browser tab; sent to this app&apos;s own server, never logged):
          <div className="askai-keyrow">
            <input
              type="password"
              placeholder="sk-ant-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveKey(); }}
            />
            <button onClick={saveKey}>Use key</button>
          </div>
          <div className="askai-fine">Or set <code>ANTHROPIC_API_KEY</code> in <code>apps/web/.env.local</code> and restart the dev server.</div>
        </div>
      ) : (
        <>
          <div className="askai-suggest">
            {SUGGESTIONS.map((s, i) => (
              <button key={i} disabled={streaming} onClick={() => ask(s)}>{s}</button>
            ))}
          </div>
          <div className="askai-inputrow">
            <input
              type="text"
              placeholder="Ask about this experiment…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(question); }}
            />
            <button disabled={streaming} onClick={() => ask(question)}>{streaming ? "…" : "Ask"}</button>
          </div>
          {answer && (
            <div className="askai-answer">
              {answer}
              {streaming && <span className="askai-caret">▋</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
