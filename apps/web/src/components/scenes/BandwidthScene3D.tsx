"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const PART = 16;

function BwContent({ n, util }: { n: number; util: number }) {
  const parts = useRef<(THREE.Mesh | null)[]>([]);
  const pipeMat = useRef<THREE.MeshStandardMaterial>(null);
  const col = util > 0.92 ? "#ff5d73" : util > 0.7 ? "#ffb454" : "#3ddc97";
  const x0 = -3.6, x1 = 3.6;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const speed = Math.max(0.05, Math.min(util, 1));
    const saturated = util > 0.92;
    for (let k = 0; k < PART; k++) {
      const m = parts.current[k];
      if (!m) continue;
      let ph = (t * 0.3 * speed + k / PART) % 1;
      // when saturated, packets bunch up near the entrance (queueing)
      if (saturated) ph = ph * ph * 0.55;
      m.position.set(x0 + ph * (x1 - x0), 0, 0);
      m.visible = ph < (saturated ? 0.55 : 1);
    }
    if (pipeMat.current) pipeMat.current.emissiveIntensity = 0.2 + 0.85 * util;
  });

  const tn = Math.min(n, 12);
  const threadYs = Array.from({ length: tn }, (_, i) => (tn === 1 ? 0 : 1.7 - (i * 3.4) / (tn - 1)));

  return (
    <>
      {/* the DRAM bus */}
      <RoundedBox args={[7.4, 0.6, 0.7]} radius={0.12} smoothness={3} position={[0, 0, 0]}>
        <meshStandardMaterial ref={pipeMat} color="#0a0f18" emissive={col} emissiveIntensity={0.4} metalness={0.3} roughness={0.4} transparent opacity={0.85} />
      </RoundedBox>
      {/* flowing packets */}
      {Array.from({ length: PART }).map((_, k) => (
        <mesh key={k} ref={(el) => { parts.current[k] = el as THREE.Mesh | null; }}>
          <sphereGeometry args={[0.1, 12, 12]} />
          <meshStandardMaterial color="#ffffff" emissive={col} emissiveIntensity={1.8} />
        </mesh>
      ))}
      {/* thread nodes feeding the bus */}
      {threadYs.map((y, i) => (
        <RoundedBox key={i} args={[0.5, 0.22, 0.3]} radius={0.05} smoothness={2} position={[-4.7, y, 0]}>
          <meshStandardMaterial color="#0b111c" emissive={util > 0.9 ? "#ff5d73" : "#4cc9f0"} emissiveIntensity={0.5} />
        </RoundedBox>
      ))}
    </>
  );
}

export default function BandwidthScene3D({ result }: { result: ExperimentResult | null }) {
  const n = Math.min((result?.params?.threads as number) ?? 24, 16);
  const util = (result?.util as number) ?? 0;
  const sat = util > 0.9;
  return (
    <Scene3DShell
      caption={sat ? "DRAM bus saturated — extra threads stall waiting for memory" : "bandwidth headroom remains"}
      captionColor={sat ? "#ff5d73" : "#3ddc97"}
      camera={{ position: [0, 0.4, 9.2], fov: 42 }}
    >
      <BwContent n={n} util={util} />
    </Scene3DShell>
  );
}
