// Shared speedup buckets for the "predict before you run" feature, used by both the
// Playground and the guided first run (/start) so the two stay in lockstep.

export const PRED_BUCKETS: { id: string; label: string }[] = [
  { id: "slower", label: "Slower (<1×)" },
  { id: "none", label: "No help (≈1×)" },
  { id: "partial", label: "Partial (a few×)" },
  { id: "strong", label: "Strong (15×+)" },
];

export const bucketOf = (sp: number) => (sp < 1 ? "slower" : sp < 3 ? "none" : sp < 12 ? "partial" : "strong");

export const bucketLabel = (id: string) => PRED_BUCKETS.find((b) => b.id === id)?.label ?? id;
