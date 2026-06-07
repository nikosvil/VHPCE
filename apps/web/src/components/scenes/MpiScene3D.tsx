"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

function MpiContent({ n, commPct }: { n: number; commPct: number }) {
  const packs = useRef<(THREE.Mesh | null)[]>([]);
  const col = commPct > 40 ? "#ff5d73" : commPct > 15 ? "#ffb454" : "#3ddc97";
  const xs = laneXs(n, 9);
  const gaps = Math.max(0, n - 1);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const speed = 0.5 * (1 + commPct / 25);
    for (let i = 0; i < gaps; i++) {
      const m = packs.current[i];
      if (!m) continue;
      const a = xs[i], b = xs[i + 1];
      const ph = (t * speed + i * 0.17) % 1;
      const tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; // ping-pong between the two neighbours
      m.position.set(a + tri * (b - a), 0, 0);
    }
  });

  return (
    <>
      {/* neighbour links */}
      {Array.from({ length: gaps }).map((_, i) => {
        const a = xs[i], b = xs[i + 1], len = Math.abs(b - a);
        return (
          <mesh key={"l" + i} position={[(a + b) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, len, 6]} />
            <meshStandardMaterial color="#1c2940" emissive="#1c2940" emissiveIntensity={0.3} />
          </mesh>
        );
      })}
      {/* rank nodes */}
      {xs.map((x, i) => (
        <RoundedBox key={"n" + i} args={[0.5, 0.5, 0.5]} radius={0.08} smoothness={3} position={[x, 0, 0]}>
          <meshStandardMaterial color="#0b111c" emissive="#4cc9f0" emissiveIntensity={0.5} metalness={0.3} roughness={0.4} />
        </RoundedBox>
      ))}
      {/* halo packets shuttling between neighbours */}
      {Array.from({ length: gaps }).map((_, i) => (
        <mesh key={"p" + i} ref={(el) => { packs.current[i] = el as THREE.Mesh | null; }}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive={col} emissiveIntensity={1.8} />
        </mesh>
      ))}
    </>
  );
}

export default function MpiScene3D({ result }: { result: ExperimentResult | null }) {
  const n = Math.min((result?.params?.ranks as number) ?? (result?.params?.threads as number) ?? 24, 12);
  const commPct = (result?.idlePct as number) ?? 0;
  const weak = result?.params?.mode === "weak";
  const col = commPct > 40 ? "#ff5d73" : commPct > 15 ? "#ffb454" : "#3ddc97";
  return (
    <Scene3DShell
      caption={weak ? "weak scaling — efficiency holds as ranks grow" : `strong scaling — communication ${Math.round(commPct)}% of runtime`}
      captionColor={weak ? "#3ddc97" : col}
      camera={{ position: [0, 1.2, 9.4], fov: 42 }}
    >
      <MpiContent n={n} commPct={commPct} />
    </Scene3DShell>
  );
}
