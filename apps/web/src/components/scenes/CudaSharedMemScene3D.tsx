"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const RED   = "#ff5d73";
const AMBER = "#ffb454";
const NUM_BANKS = 16;

function AccessDot({ bankIdx, stride, padded, lane }: { bankIdx: number; stride: number; padded: boolean; lane: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const effectiveStride = padded ? 1 : stride;
    const delay = padded ? (lane / 32) : (lane % effectiveStride) / effectiveStride;
    const phase = ((t * 0.9 - delay) % 1 + 1) % 1;
    const active = phase < 0.3;
    ref.current.scale.setScalar(active ? 1 : 0.4);
    (ref.current.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 1.8 : 0.2;
  });
  const col = padded || stride === 1 ? GREEN : stride <= 4 ? AMBER : RED;
  const xStep = 10.5 / NUM_BANKS;
  const x = -5 + bankIdx * xStep;
  return (
    <mesh ref={ref} position={[x, 1.4, 0.2]}>
      <sphereGeometry args={[0.13, 8, 8]} />
      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.5} />
    </mesh>
  );
}

function SharedMemContent({ stride, padded }: { stride: number; padded: boolean }) {
  const xStep = 10.5 / NUM_BANKS;

  return (
    <>
      {/* Bank pillars */}
      {Array.from({ length: NUM_BANKS }).map((_, i) => {
        const x = -5 + i * xStep;
        const conflict = !padded && stride > 1 && i % stride === 0;
        const col = conflict ? RED : GREEN;
        return (
          <group key={i} position={[x, -0.4, 0]}>
            <mesh>
              <boxGeometry args={[0.36, 1.6, 0.25]} />
              <meshStandardMaterial
                color="#0b111c"
                emissive={col}
                emissiveIntensity={conflict ? 0.7 : 0.25}
              />
            </mesh>
            {/* Bank index tick */}
            <mesh position={[0, -0.9, 0]}>
              <boxGeometry args={[0.04, 0.2, 0.1]} />
              <meshStandardMaterial color="#1c2940" />
            </mesh>
          </group>
        );
      })}

      {/* Access dots (warp lanes) */}
      {Array.from({ length: NUM_BANKS }).map((_, i) => (
        <AccessDot key={i} bankIdx={i} stride={stride} padded={padded} lane={i} />
      ))}

      {/* Padding rail */}
      {padded && (
        <mesh position={[0, 1.9, 0]}>
          <boxGeometry args={[10.5, 0.1, 0.15]} />
          <meshStandardMaterial color={GREEN} emissive={GREEN} emissiveIntensity={0.5} />
        </mesh>
      )}
    </>
  );
}

export default function CudaSharedMemScene3D({ result }: { result: ExperimentResult | null }) {
  const stride  = (result?.current?.x as number) ?? 1;
  const padded  = (result?.params?.padding as boolean) ?? false;
  const clean   = padded || stride === 1;
  const col     = clean ? GREEN : stride <= 4 ? AMBER : RED;
  const label   = clean
    ? "conflict-free — all 16 banks serve in parallel"
    : `${stride}-way bank conflict — access serialised into ${stride} passes`;
  return (
    <Scene3DShell
      caption={label}
      captionColor={col}
      camera={{ position: [0, 0.8, 10.5], fov: 50 }}
    >
      <SharedMemContent stride={stride} padded={padded} />
    </Scene3DShell>
  );
}
