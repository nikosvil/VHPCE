"use client";

import { useState } from "react";
import Link from "next/link";
import WaveLab from "./modules/WaveLab";
import NBodyLab from "./modules/NBodyLab";
import GemmLab from "./modules/GemmLab";
import FFTLab from "./modules/FFTLab";
import SpMVLab from "./modules/SpMVLab";
import MultigridLab from "./modules/MultigridLab";

const TABS = [
  { id: "wave",  label: "🌊 Wave (FDTD)" },
  { id: "nbody", label: "🌌 N-Body Gravity" },
  { id: "gemm",  label: "🔢 Matrix Multiply" },
  { id: "fft",   label: "📊 FFT" },
  { id: "spmv",  label: "🔗 Sparse SpMV" },
  { id: "mg",    label: "🔻 Multigrid" },
];

export default function Modules() {
  const [tab, setTab] = useState("wave");
  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <h1><span className="why">Domain</span> Labs</h1>
          <div className="sub">Engineering simulations and numerical kernels — from wave physics to sparse solvers — and how they parallelize across OpenMP, MPI &amp; GPU.</div>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <Link href="/lab" className="tab" style={{ opacity: 0.65 }}>🔬 Heat Equation ↗</Link>
      </nav>

      {tab === "wave"  && <WaveLab />}
      {tab === "nbody" && <NBodyLab />}
      {tab === "gemm"  && <GemmLab />}
      {tab === "fft"   && <FFTLab />}
      {tab === "spmv"  && <SpMVLab />}
      {tab === "mg"    && <MultigridLab />}
    </main>
  );
}
