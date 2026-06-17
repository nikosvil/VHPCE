"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const LEVELS = [
  { name: "L1",   r: 0.7,  col: "#3ddc97", label: "L1 — 32 KB / core" },
  { name: "L2",   r: 1.4,  col: "#5eb8ff", label: "L2 — 512 KB / core" },
  { name: "L3",   r: 2.2,  col: "#ffb454", label: "L3 — 24 MB shared" },
  { name: "DRAM", r: 3.2,  col: "#ff5d73", label: "DRAM — 40 GB/s" },
];

function DataParticle({ targetR, col }: { targetR: number; col: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const ang = t * 1.4;
    ref.current.position.set(Math.cos(ang) * targetR, Math.sin(ang) * targetR, 0.3);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.14, 12, 12]} />
      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={2.2} />
    </mesh>
  );
}

function CacheContent({ level }: { level: string }) {
  const activeIdx = LEVELS.findIndex((l) => l.name === level);
  const active = LEVELS[activeIdx] ?? LEVELS[3];

  return (
    <>
      {/* CPU core at center */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.4, 0.4, 0.2]} />
        <meshStandardMaterial color="#0b111c" emissive="#4cc9f0" emissiveIntensity={0.8} />
      </mesh>

      {/* Concentric rings */}
      {LEVELS.map((lv, i) => {
        const isActive = i === activeIdx;
        return (
          <mesh key={lv.name} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[lv.r, isActive ? 0.07 : 0.03, 8, 64]} />
            <meshStandardMaterial
              color={lv.col}
              emissive={lv.col}
              emissiveIntensity={isActive ? 1.4 : 0.2}
              transparent
              opacity={isActive ? 1 : 0.4}
            />
          </mesh>
        );
      })}

      {/* Data particle orbiting at the active level */}
      <DataParticle targetR={active.r} col={active.col} />

      {/* Labels on the right side */}
      {LEVELS.map((lv, i) => (
        <mesh key={"lb" + lv.name} position={[lv.r + 0.05, 0, 0]}>
          <sphereGeometry args={[i === activeIdx ? 0.12 : 0.06, 8, 8]} />
          <meshStandardMaterial color={lv.col} emissive={lv.col} emissiveIntensity={i === activeIdx ? 1.8 : 0.4} />
        </mesh>
      ))}
    </>
  );
}

export default function CacheHierarchyScene3D({ result }: { result: ExperimentResult | null }) {
  const level  = (result?.params?.level as string) ?? "DRAM";
  const active = LEVELS.find((l) => l.name === level) ?? LEVELS[3];
  return (
    <Scene3DShell
      caption={active.label + " — " + (level === "L1" || level === "L2" ? "private cache per core" : level === "L3" ? "shared last-level cache" : "off-chip DRAM")}
      captionColor={active.col}
      camera={{ position: [0, 1.5, 9], fov: 44 }}
    >
      <CacheContent level={level} />
    </Scene3DShell>
  );
}
