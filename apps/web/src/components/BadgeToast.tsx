"use client";

import { useEffect, useState } from "react";
import { UNLOCK_EVENT, type Badge } from "../lib/badges";

// Global, mounted once in the Nav: pops a transient toast whenever a badge unlocks anywhere.
export default function BadgeToast() {
  const [badge, setBadge] = useState<Badge | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onUnlock = (e: Event) => {
      setBadge((e as CustomEvent).detail as Badge);
      clearTimeout(timer);
      timer = setTimeout(() => setBadge(null), 4200);
    };
    window.addEventListener(UNLOCK_EVENT, onUnlock);
    return () => { window.removeEventListener(UNLOCK_EVENT, onUnlock); clearTimeout(timer); };
  }, []);

  if (!badge) return null;
  return (
    <div className="badge-toast" role="status">
      <span className="badge-toast-icon">{badge.icon}</span>
      <div>
        <div className="badge-toast-title">Badge unlocked — {badge.title}</div>
        <div className="badge-toast-desc">{badge.desc}</div>
      </div>
    </div>
  );
}
