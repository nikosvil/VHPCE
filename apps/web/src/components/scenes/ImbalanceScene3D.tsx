"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

const MAXH = 2.2; // height of the busiest thread (== finish line)

function ImbContent({ n, sched }: { n: number; sched: string }) {
  const xs = laneXs(n);
  // normalized per-thread workload (0..1); static = triangular ramp, others ~ balanced
  let work: number[];
  if (sched === "static") {
    const w = xs.map((_, t) => 2 * t + 1);
    const mx = Math.max(...w);
    work = w.map((v) => v / mx);
  } else {
    const jit = sched === "guided" ? 0.1 : 0.04;
    const w = xs.map((_, t) => 0.92 + jit * Math.sin(t * 1.7));
    const mx = Math.max(...w);
    work = w.map((v) => v / mx);
  }
  const bars = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const cyc = clock.getElapsedTime() % 3.2;
    const prog = Math.min(1, cyc / 1.2); // fill quickly (~1.2s), then hold the ramp
    for (let i = 0; i < n; i++) {
      const o = bars.current[i];
      if (!o) continue;
      const h = Math.max(0.02, Math.min(prog, work[i]) * MAXH);
      o.scale.y = h;
      o.position.y = h / 2; // grow up from the floor (y=0)
    }
  });

  const lineW = Math.min(10, n * 0.8) + 1;
  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} ref={(el) => { bars.current[i] = el as THREE.Mesh | null; }} position={[x, 0, 0]}>
          <boxGeometry args={[0.5, 1, 0.45]} />
          <meshStandardMaterial color="#0b111c" emissive={sched === "static" ? "#4cc9f0" : "#3ddc97"} emissiveIntensity={0.7} metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
      {/* finish line at the busiest thread's height — everyone waits for it */}
      <mesh position={[0, MAXH, 0]}>
        <boxGeometry args={[lineW, 0.03, 0.7]} />
        <meshStandardMaterial color="#ffb454" emissive="#ffb454" emissiveIntensity={1} transparent opacity={0.55} />
      </mesh>
    </>
  );
}

export default function ImbalanceScene3D({ result }: { result: ExperimentResult | null }) {
  const n = Math.min((result?.params?.threads as number) ?? 24, 16);
  const sched = (result?.params?.sched as string) ?? "static";
  const caption =
    sched === "static"
      ? "Static: late threads overloaded; early threads idle below the finish line"
      : "Balanced: every core finishes near the same time";
  return (
    <Scene3DShell caption={caption} captionColor={sched === "static" ? "#ffb454" : "#3ddc97"} camera={{ position: [0, 1.4, 9], fov: 42 }}>
      <ImbContent n={n} sched={sched} />
    </Scene3DShell>
  );
}
