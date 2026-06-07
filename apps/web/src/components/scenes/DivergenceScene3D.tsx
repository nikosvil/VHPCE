"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

const LANES = 32;

function DivergenceContent({ paths, color }: { paths: number; color: string }) {
  const D = Math.max(1, paths);
  const xs = laneXs(LANES, 9);
  const w = (xs[1] - xs[0]) * 0.82;
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pass = Math.floor(t / 0.75) % D;   // which branch path runs now
    for (let i = 0; i < LANES; i++) {
      const m = mats.current[i];
      if (!m) continue;
      const active = (i % D) === pass;
      m.emissiveIntensity = active ? 0.55 + 0.4 * Math.abs(Math.sin(t * 2 + i)) : 0.05;
      m.emissive.set(active ? color : "#1c2940");
    }
  });

  return (
    <>
      {xs.map((x, i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <boxGeometry args={[w, 1.4, 0.4]} />
          <meshStandardMaterial
            ref={(el) => { mats.current[i] = el as THREE.MeshStandardMaterial | null; }}
            color="#0b1a1f" emissive={color} emissiveIntensity={0.5} metalness={0.3} roughness={0.5}
          />
        </mesh>
      ))}
    </>
  );
}

export default function DivergenceScene3D({ result }: { result: ExperimentResult | null }) {
  const paths = Math.max(1, Math.round(result?.current?.x ?? 1));
  const eff = result?.current?.efficiency ?? 1 / paths;
  const col = eff > 0.6 ? "#3ddc97" : eff > 0.3 ? "#ffb454" : "#ff5d73";
  return (
    <Scene3DShell
      caption={paths === 1
        ? "uniform — all 32 lanes run together · full throughput"
        : `${paths} branch paths — warp replays ${paths}× · ${Math.round((1 - eff) * 100)}% of lane-cycles idle`}
      captionColor={col}
      camera={{ position: [0, 0, 9.2], fov: 42 }}
    >
      <DivergenceContent paths={paths} color={col} />
    </Scene3DShell>
  );
}
