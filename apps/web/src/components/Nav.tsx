"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav() {
  const p = usePathname();
  return (
    <nav className="topnav">
      <span className="topnav-brand">VHPCE</span>
      <Link href="/" className={p === "/" ? "active" : ""}>Flagship</Link>
      <Link href="/playground" className={p === "/playground" ? "active" : ""}>Playground</Link>
    </nav>
  );
}
