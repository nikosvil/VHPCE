"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

const THREADS = 16; // representative

function AtomicsContent({ targets, color }: { targets: number; color: string }) {
  const cells = Math.min(Math.max(1, targets), 16);
  const load = Math.ceil(THREADS / cells);     // representative threads queued per counter
  const xs = laneXs(cells, 9);
  const w = cells > 1 ? (xs[1] - xs[0]) * 0.7 : 1.4;
  const h = Math.min(0.5 + load * 0.42, 5.2);   // queue depth → bar height
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < cells; i++) {
      const m = mats.current[i];
      if (m) m.emissiveIntensity = 0.4 + 0.4 * Math.abs(Math.sin(t * 2 + i * 0.5));
    }
  });

  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} position={[x, h / 2 - 1.6, 0]}>
          <boxGeometry args={[w, h, 0.6]} />
          <meshStandardMaterial
            ref={(el) => { mats.current[i] = el as THREE.MeshStandardMaterial | null; }}
            color="#0b1a1f" emissive={color} emissiveIntensity={0.6} metalness={0.3} roughness={0.5}
          />
        </mesh>
      ))}
    </>
  );
}

export default function AtomicsScene3D({ result }: { result: ExperimentResult | null }) {
  const targets = Math.max(1, Math.round(result?.current?.x ?? 1));
  const eff = result?.current?.efficiency ?? 0;
  const col = eff > 0.6 ? "#3ddc97" : eff > 0.3 ? "#ffb454" : "#ff5d73";
  const cells = Math.min(targets, 16);
  const load = Math.ceil(16 / cells);
  return (
    <Scene3DShell
      caption={targets === 1
        ? "one counter — a deep serial queue of atomic updates"
        : `${cells}${cells < targets ? "+" : ""} counters · queue depth ≈ ${load} · ${Math.round(eff * 100)}% of peak`}
      captionColor={col}
      camera={{ position: [0, 0.5, 9.5], fov: 42 }}
    >
      <AtomicsContent targets={targets} color={col} />
    </Scene3DShell>
  );
}
