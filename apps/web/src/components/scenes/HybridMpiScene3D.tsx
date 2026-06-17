"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const AMBER = "#ffb454";
const CYAN  = "#4cc9f0";

function ThreadSphere({ rankX, rankW, tIdx, totalT, active }: { rankX: number; rankW: number; tIdx: number; totalT: number; active: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() + tIdx * 0.7;
    const x = rankX + (totalT > 1 ? (-rankW / 2 + (tIdx / (totalT - 1)) * rankW) : 0);
    const bob = Math.sin(t * 1.4 + tIdx) * 0.12;
    ref.current.position.set(x, bob, 0.22);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.13, 8, 8]} />
      <meshStandardMaterial color={active ? GREEN : "#1a2436"} emissive={active ? GREEN : "#111"} emissiveIntensity={active ? 1.4 : 0.1} />
    </mesh>
  );
}

function MpiPacket({ from, to, phase }: { from: [number, number]; to: [number, number]; phase: number }) {
  const [fx, fy] = from;
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.getElapsedTime() * 0.7 + phase) % 1 + 1) % 1;
    ref.current.position.set(fx + t * (to[0] - fx), fy + t * (to[1] - fy), 0.4);
    ref.current.scale.setScalar(0.5 + 0.5 * Math.sin(t * Math.PI));
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color={CYAN} emissive={CYAN} emissiveIntensity={1.6} />
    </mesh>
  );
}

const TOTAL_CORES = 24;

function HybridContent({ ranks, tpr }: { ranks: number; tpr: number }) {
  const clamped = Math.max(1, Math.min(ranks, 8));
  const threadsPerRank = Math.min(tpr, Math.floor(TOTAL_CORES / clamped));
  const rankW  = 0.9 + threadsPerRank * 0.22;
  const span   = Math.min(10, clamped * (rankW + 0.4));
  const step   = clamped > 1 ? span / (clamped - 1) : 0;
  const startX = -span / 2;
  const rankPositions = Array.from({ length: clamped }, (_, i) => startX + i * step);

  const activeCores = Math.min(TOTAL_CORES, clamped * tpr);

  return (
    <>
      {/* Rank boxes */}
      {rankPositions.map((x, ri) => (
        <group key={ri} position={[x, 0, 0]}>
          <RoundedBox args={[rankW, 1.0, 0.35]} radius={0.08} smoothness={3}>
            <meshStandardMaterial color="#0b111c" emissive={AMBER} emissiveIntensity={0.2} metalness={0.3} roughness={0.5} />
          </RoundedBox>
          {/* Thread spheres inside each rank */}
          {Array.from({ length: threadsPerRank }).map((_, ti) => (
            <ThreadSphere key={ti} rankX={0} rankW={rankW * 0.7} tIdx={ti} totalT={threadsPerRank} active={ri * tpr + ti < activeCores} />
          ))}
        </group>
      ))}

      {/* MPI links between ranks */}
      {rankPositions.slice(0, -1).map((x, i) => {
        const x2 = rankPositions[i + 1];
        const len = Math.abs(x2 - x) - rankW;
        return len > 0.1 ? (
          <mesh key={"l" + i} position={[(x + x2) / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.025, 0.025, len, 6]} />
            <meshStandardMaterial color="#1c2940" emissive={CYAN} emissiveIntensity={0.3} />
          </mesh>
        ) : null;
      })}

      {/* MPI packets */}
      {rankPositions.slice(0, -1).map((x, i) => (
        <MpiPacket key={i} from={[x + rankW / 2, 0]} to={[rankPositions[i + 1] - rankW / 2, 0]} phase={i * 0.3} />
      ))}
    </>
  );
}

export default function HybridMpiScene3D({ result }: { result: ExperimentResult | null }) {
  const ranks = (result?.current?.x as number) ?? 4;
  const tpr   = (result?.params?.threadsPerRank as number) ?? 4;
  const activeCores = Math.min(TOTAL_CORES, ranks * tpr);
  const isPure = tpr === 1;
  const col = activeCores >= TOTAL_CORES && !isPure ? GREEN : AMBER;
  return (
    <Scene3DShell
      caption={`${ranks} MPI rank${ranks > 1 ? "s" : ""} × ${Math.min(tpr, Math.floor(TOTAL_CORES / ranks))} threads — ${activeCores}/${TOTAL_CORES} cores active`}
      captionColor={col}
      camera={{ position: [0, 0.8, 10.5], fov: 46 }}
    >
      <HybridContent ranks={ranks} tpr={tpr} />
    </Scene3DShell>
  );
}
