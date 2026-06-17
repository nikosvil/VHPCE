"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const AMBER = "#ffb454";

function SimdContent({ width, isSoA }: { width: number; isSoA: boolean }) {
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const MAX = 16;
  const laneW = 0.38, gap = 0.10, totalW = MAX * (laneW + gap);
  const startX = -totalW / 2 + laneW / 2;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < MAX; i++) {
      const m = meshes.current[i];
      if (!m) continue;
      const active = i < width;
      if (!active) { m.scale.setScalar(1); return; }
      if (isSoA) {
        // All lanes pulse together
        const pulse = 0.85 + 0.15 * Math.sin(t * 2.5);
        m.scale.setScalar(pulse);
      } else {
        // Lanes fire sequentially (gather scatter)
        const delay = i / width;
        const phase = ((t * 0.8 - delay) % 1 + 1) % 1;
        const pulse = 0.7 + 0.3 * Math.max(0, Math.sin(phase * Math.PI * 2));
        m.scale.setScalar(0.8 + pulse * 0.25);
      }
    }
  });

  return (
    <>
      {Array.from({ length: MAX }).map((_, i) => {
        const active = i < width;
        const col = !active ? "#1a2436" : isSoA ? GREEN : AMBER;
        return (
          <mesh
            key={i}
            ref={(el) => { meshes.current[i] = el as THREE.Mesh | null; }}
            position={[startX + i * (laneW + gap), 0, 0]}
          >
            <boxGeometry args={[laneW, 1.6, 0.25]} />
            <meshStandardMaterial
              color={active ? col : "#0b111c"}
              emissive={col}
              emissiveIntensity={active ? 0.9 : 0.05}
              transparent
              opacity={active ? 1 : 0.3}
            />
          </mesh>
        );
      })}
      {/* Width bracket */}
      <mesh position={[startX + (width - 1) * (laneW + gap) / 2, -1.2, 0]}>
        <boxGeometry args={[width * (laneW + gap) - gap, 0.04, 0.1]} />
        <meshStandardMaterial color={isSoA ? GREEN : AMBER} emissive={isSoA ? GREEN : AMBER} emissiveIntensity={0.6} />
      </mesh>
    </>
  );
}

export default function SimdVecScene3D({ result }: { result: ExperimentResult | null }) {
  const width  = (result?.current?.x as number) ?? 8;
  const layout = (result?.params?.layout as string) ?? "AoS";
  const isSoA  = layout === "SoA";
  const col    = isSoA ? GREEN : AMBER;
  return (
    <Scene3DShell
      caption={`${width} SIMD lanes — ${isSoA ? "SoA: all lanes fire simultaneously" : "AoS: lanes scatter-gather (sequential)"}`}
      captionColor={col}
      camera={{ position: [0, 0.5, 10], fov: 50 }}
    >
      <SimdContent width={width} isSoA={isSoA} />
    </Scene3DShell>
  );
}
