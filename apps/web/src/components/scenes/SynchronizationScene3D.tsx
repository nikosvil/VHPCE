"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

const CYAN = "#4cc9f0", AMBER = "#ffb454", GREEN = "#3ddc97";

function SyncContent({ n, mode }: { n: number; mode: string }) {
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const token = useRef<THREE.Mesh>(null);
  const xs = laneXs(n);
  const period = mode === "critical" ? 0.5 : 0.18; // lock-hold time per core

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (mode === "reduction") {
      // all cores work in parallel; a central merge orb pulses
      for (let i = 0; i < n; i++) {
        const m = mats.current[i];
        if (m) m.emissiveIntensity += (0.7 + 0.3 * Math.sin(t * 4 + i) - m.emissiveIntensity) * 0.2;
      }
      if (token.current) {
        token.current.position.set(0, 1.7, 0);
        token.current.scale.setScalar(1 + 0.4 * Math.sin(t * 6));
        token.current.rotation.y = t;
      }
    } else {
      // lock hops core-to-core: only the holder lights; others wait
      const holder = Math.floor(t / period) % n;
      for (let i = 0; i < n; i++) {
        const m = mats.current[i];
        if (m) m.emissiveIntensity += ((i === holder ? 1.5 : 0.08) - m.emissiveIntensity) * 0.3;
      }
      if (token.current) {
        token.current.position.set(xs[holder], 1.4, 0);
        token.current.scale.setScalar(1 + 0.3 * Math.sin(t * 12));
        token.current.rotation.y = t * 2.5;
      }
    }
  });

  return (
    <>
      {xs.map((x, i) => (
        <RoundedBox key={i} args={[0.5, 1.0, 0.45]} radius={0.07} smoothness={3} position={[x, 0.3, 0]}>
          <meshStandardMaterial
            ref={(el) => { mats.current[i] = el as THREE.MeshStandardMaterial | null; }}
            color="#0b111c" emissive={mode === "reduction" ? CYAN : AMBER} emissiveIntensity={0.2}
            metalness={0.4} roughness={0.35}
          />
        </RoundedBox>
      ))}
      <mesh ref={token} position={[0, 1.4, 0]}>
        <octahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial color="#ffffff" emissive={mode === "reduction" ? GREEN : AMBER} emissiveIntensity={2.2} />
      </mesh>
    </>
  );
}

export default function SynchronizationScene3D({ result }: { result: ExperimentResult | null }) {
  const n = Math.min((result?.params?.threads as number) ?? 24, 16);
  const mode = (result?.params?.mode as string) ?? "critical";
  const caption =
    mode === "reduction"
      ? "Per-thread partials — all cores run in parallel, one merge at the end"
      : `The ${mode} lock hops core-to-core — the hot loop runs one thread at a time`;
  return (
    <Scene3DShell caption={caption} captionColor={mode === "reduction" ? GREEN : AMBER} camera={{ position: [0, 1.1, 8.2], fov: 42 }}>
      <SyncContent n={n} mode={mode} />
    </Scene3DShell>
  );
}
