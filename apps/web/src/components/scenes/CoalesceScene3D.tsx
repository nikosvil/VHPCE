"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell, laneXs } from "./Shell";

const LANES = 32;   // warp lanes / elements per 128B cache line
const MAXLINES = 6; // cache-line slabs drawn (cap for space)

function CoalesceContent({ stride, color }: { stride: number; color: string }) {
  const lines = Math.min(stride, MAXLINES);
  const xs = laneXs(LANES, 9);
  const slotW = (xs[1] - xs[0]) * 0.82;
  const laneMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const slotMats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    for (let i = 0; i < LANES; i++) {
      const m = laneMats.current[i];
      if (m) m.emissiveIntensity = 0.35 + 0.45 * Math.abs(Math.sin(t * 1.4 + i * 0.25));
    }
    for (let l = 0; l < lines; l++) {
      for (let e = 0; e < LANES; e++) {
        const m = slotMats.current[l * LANES + e];
        if (!m) continue;
        const touched = ((l * LANES + e) % stride) === 0;
        m.emissiveIntensity = touched ? 0.5 + 0.4 * Math.abs(Math.sin(t * 1.6 + e * 0.2)) : 0.04;
      }
    }
  });

  const lineTop = 0.9, lineGap = (MAXLINES > 1 ? 2.8 / (MAXLINES - 1) : 0);

  return (
    <>
      {/* warp lanes */}
      {xs.map((x, i) => (
        <mesh key={"lane" + i} position={[x, 2.1, 0]}>
          <boxGeometry args={[slotW, 0.42, 0.34]} />
          <meshStandardMaterial
            ref={(el) => { laneMats.current[i] = el as THREE.MeshStandardMaterial | null; }}
            color="#0b1a1f" emissive={color} emissiveIntensity={0.6} metalness={0.3} roughness={0.5}
          />
        </mesh>
      ))}
      {/* cache-line slabs */}
      {Array.from({ length: lines }).map((_, l) =>
        xs.map((x, e) => {
          const touched = ((l * LANES + e) % stride) === 0;
          return (
            <mesh key={"s" + l + "-" + e} position={[x, lineTop - l * lineGap, 0]}>
              <boxGeometry args={[slotW, 0.34, 0.3]} />
              <meshStandardMaterial
                ref={(el) => { slotMats.current[l * LANES + e] = el as THREE.MeshStandardMaterial | null; }}
                color={touched ? "#0b1a1f" : "#0a0f18"}
                emissive={touched ? color : "#1c2940"}
                emissiveIntensity={touched ? 0.6 : 0.04}
                metalness={0.3} roughness={0.55}
              />
            </mesh>
          );
        }),
      )}
    </>
  );
}

export default function CoalesceScene3D({ result }: { result: ExperimentResult | null }) {
  const stride = Math.max(1, Math.round(result?.current?.x ?? 1));
  const eff = result?.current?.efficiency ?? 1 / stride;
  const col = eff > 0.6 ? "#3ddc97" : eff > 0.3 ? "#ffb454" : "#ff5d73";
  return (
    <Scene3DShell
      caption={stride === 1
        ? "coalesced — one cache line serves the whole warp · 0% wasted"
        : `stride ${stride} — warp spans ${stride} cache lines · ${Math.round((1 - eff) * 100)}% bandwidth wasted`}
      captionColor={col}
      camera={{ position: [0, -0.3, 9.2], fov: 42 }}
    >
      <CoalesceContent stride={stride} color={col} />
    </Scene3DShell>
  );
}
