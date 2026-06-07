"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const MAX_WARPS = 48;
const COLS = 8;

function CudaContent({ occ, color }: { occ: number; color: string }) {
  const active = Math.round(occ * MAX_WARPS);
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < MAX_WARPS; i++) {
      const m = mats.current[i];
      if (!m) continue;
      m.emissiveIntensity = i < active ? 0.5 + 0.5 * Math.abs(Math.sin(t * 1.6 + i * 0.3)) : 0.05;
    }
  });

  const rows = Math.ceil(MAX_WARPS / COLS);
  const gap = 0.62;
  const x0 = -((COLS - 1) * gap) / 2;
  const y0 = ((rows - 1) * gap) / 2;

  return (
    <>
      {Array.from({ length: MAX_WARPS }).map((_, i) => {
        const r = Math.floor(i / COLS), c = i % COLS;
        const on = i < active;
        return (
          <RoundedBox key={i} args={[0.5, 0.5, 0.3]} radius={0.06} smoothness={2} position={[x0 + c * gap, y0 - r * gap, 0]}>
            <meshStandardMaterial
              ref={(el) => { mats.current[i] = el as THREE.MeshStandardMaterial | null; }}
              color={on ? "#0b1a1f" : "#0a0f18"}
              emissive={on ? color : "#1c2940"}
              emissiveIntensity={on ? 0.6 : 0.05}
              metalness={0.3}
              roughness={0.5}
            />
          </RoundedBox>
        );
      })}
    </>
  );
}

export default function CudaScene3D({ result }: { result: ExperimentResult | null }) {
  const occ = (result?.occupancy as number) ?? (result?.current?.efficiency as number) ?? 0;
  const col = occ > 0.66 ? "#3ddc97" : occ > 0.4 ? "#ffb454" : "#ff5d73";
  const heavy = result?.params?.variant === "heavy";
  return (
    <Scene3DShell
      caption={heavy ? `register-limited — ${Math.round(occ * 100)}% occupancy` : `${Math.round(occ * 100)}% occupancy — warps fill the SM`}
      captionColor={col}
      camera={{ position: [0, 0, 8.6], fov: 42 }}
    >
      <CudaContent occ={occ} color={col} />
    </Scene3DShell>
  );
}
