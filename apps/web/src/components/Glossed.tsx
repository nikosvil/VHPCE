"use client";

import { Fragment, type ReactNode } from "react";
import { GLOSSARY_KEYS } from "./glossary";
import Term from "./Term";

// Auto-wrap the first occurrence of each known glossary term in a plain string with <Term>.
// Longest terms win first (so "cache line" beats "line"), matches respect word boundaries, are
// non-overlapping, and each term is linked at most once. Turns the glossary into a project-wide
// capability: any prose passed through <Glossed> gets hover definitions, no manual tagging.
export default function Glossed({ children }: { children?: string | null }) {
  const text = children ?? "";
  if (!text) return null;
  const keys = [...GLOSSARY_KEYS].sort((a, b) => b.length - a.length);
  const lower = text.toLowerCase();
  const taken = new Array(text.length).fill(false);
  const matches: { start: number; end: number; key: string }[] = [];
  const isWord = (c: string | undefined) => !!c && /[a-z0-9]/i.test(c);

  for (const key of keys) {
    let from = 0;
    for (;;) {
      const idx = lower.indexOf(key, from);
      if (idx === -1) break;
      const end = idx + key.length;
      const boundary = !isWord(text[idx - 1]) && !isWord(text[end]);
      let free = true;
      for (let i = idx; i < end; i++) if (taken[i]) { free = false; break; }
      if (boundary && free) {
        matches.push({ start: idx, end, key });
        for (let i = idx; i < end; i++) taken[i] = true;
        break; // first occurrence per key only
      }
      from = end;
    }
  }
  if (matches.length === 0) return <>{text}</>;
  matches.sort((a, b) => a.start - b.start);

  const out: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) out.push(<Fragment key={"s" + i}>{text.slice(cursor, m.start)}</Fragment>);
    out.push(<Term key={"k" + i} k={m.key}>{text.slice(m.start, m.end)}</Term>);
    cursor = m.end;
  });
  if (cursor < text.length) out.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>);
  return <>{out}</>;
}
