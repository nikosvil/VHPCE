"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import BadgeToast from "./BadgeToast";

export default function Nav() {
  const p = usePathname();
  return (
    <>
      <nav className="topnav">
        <span className="topnav-brand">VHPCE</span>
        <Link href="/intro" className={p === "/intro" ? "active" : ""}>Intro</Link>
        <Link href="/start" className={p === "/start" ? "active" : ""}>Start</Link>
        <Link href="/learn" className={p === "/learn" ? "active" : ""}>Learn</Link>
        <Link href="/reference" className={p === "/reference" ? "active" : ""}>Reference</Link>
        <Link href="/modules" className={p.startsWith("/modules") || p === "/lab" ? "active" : ""}>Labs</Link>
        <Link href="/" className={p === "/" ? "active" : ""}>Flagship</Link>
        <Link href="/compare" className={p === "/compare" ? "active" : ""}>Compare</Link>
        <Link href="/playground" className={p === "/playground" ? "active" : ""}>Playground</Link>
        <Link href="/play" className={p === "/play" ? "active" : ""}>Play</Link>
      </nav>
      <BadgeToast />
    </>
  );
}
