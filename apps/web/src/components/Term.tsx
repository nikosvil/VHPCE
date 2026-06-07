"use client";

import type { ReactNode } from "react";
import { GLOSSARY } from "./glossary";

// Inline glossary term: dotted-underline word with a hover/focus tooltip definition.
// <Term k="rank">rank</Term>  — falls back to plain text if the key isn't in the glossary.
export default function Term({ k, children }: { k: string; children?: ReactNode }) {
  const def = GLOSSARY[k];
  const label = children ?? k;
  if (!def) return <>{label}</>;
  return (
    <span className="term" tabIndex={0} role="note" aria-label={`${typeof label === "string" ? label : k}: ${def}`}>
      {label}
      <span className="term-pop">{def}</span>
    </span>
  );
}
