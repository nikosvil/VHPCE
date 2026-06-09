// Lightweight, localStorage-backed achievements + predict streak/score. No backend.
// Components call record* in event handlers / async callbacks (never during render);
// the store dispatches DOM events so the Badges tab and the toast update live.

export type Badge = { id: string; icon: string; title: string; desc: string };

export const BADGES: Badge[] = [
  { id: "first_run", icon: "🚀", title: "Liftoff", desc: "Ran your first kernel on real cores." },
  { id: "slower", icon: "🐌", title: "Backwards", desc: "Made code run SLOWER by adding threads." },
  { id: "speed_demon", icon: "⚡", title: "Speed Demon", desc: "Hit a 10× speedup or better." },
  { id: "oracle", icon: "🔮", title: "Oracle", desc: "Predicted a result correctly." },
  { id: "on_fire", icon: "🔥", title: "On Fire", desc: "Three correct predictions in a row." },
  { id: "racer", icon: "🏁", title: "At the Races", desc: "Ran a head-to-head kernel race." },
  { id: "detective", icon: "🔬", title: "Detective", desc: "Profiled a kernel's cache misses." },
];

export type BadgeState = { unlocked: string[]; hits: number; total: number; streak: number; best: number };
const EMPTY: BadgeState = { unlocked: [], hits: 0, total: 0, streak: 0, best: 0 };
const KEY = "vhpce.badges.v1";

export const EVENT = "vhpce-badges";              // state changed → re-read
export const UNLOCK_EVENT = "vhpce-badge-unlock"; // a new badge unlocked → toast

export function getState(): BadgeState {
  if (typeof window === "undefined") return { ...EMPTY };
  try { return { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...EMPTY }; }
}

function commit(mutate: (s: BadgeState) => void): void {
  if (typeof window === "undefined") return;
  const s = getState();
  const before = new Set(s.unlocked);
  mutate(s);
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent(EVENT));
  const newlyId = s.unlocked.find((id) => !before.has(id));
  const badge = newlyId && BADGES.find((b) => b.id === newlyId);
  if (badge) window.dispatchEvent(new CustomEvent(UNLOCK_EVENT, { detail: badge }));
}

const add = (s: BadgeState, id: string) => { if (!s.unlocked.includes(id)) s.unlocked.push(id); };

export function recordRun(o: { speedup: number; profiled?: boolean }): void {
  commit((s) => {
    add(s, "first_run");
    if (o.speedup < 1) add(s, "slower");
    if (o.speedup >= 10) add(s, "speed_demon");
    if (o.profiled) add(s, "detective");
  });
}

export function recordPredict(hit: boolean): void {
  commit((s) => {
    s.total++;
    if (hit) { s.hits++; s.streak++; if (s.streak > s.best) s.best = s.streak; add(s, "oracle"); if (s.streak >= 3) add(s, "on_fire"); }
    else s.streak = 0;
  });
}

export function recordRace(): void {
  commit((s) => add(s, "racer"));
}
