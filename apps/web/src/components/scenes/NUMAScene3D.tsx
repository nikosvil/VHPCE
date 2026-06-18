"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const RED   = "#ff5d73";
const AMBER = "#ffb454";
const NODE_SIZE = 12;

function Packet({ from, to, phase, col }: { from: [number, number, number]; to: [number, number, number]; phase: number; col: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.getElapsedTime() * 0.6 + phase) % 1);
    ref.current.position.set(
      from[0] + t * (to[0] - from[0]),
      from[1] + t * (to[1] - from[1]) + Math.sin(t * Math.PI) * 0.4,
      from[2] + t * (to[2] - from[2]),
    );
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.6} />
    </mesh>
  );
}

function Socket({ x, cores, label: _label, col }: { x: number; cores: number; label: string; col: string }) {
  const xs = Array.from({ length: Math.min(cores, 6) }, (_, i) => x - 0.75 + i * 0.3);
  const ys = [0.3, -0.05];
  return (
    <group position={[x, 0, 0]}>
      <RoundedBox args={[2.2, 1.0, 0.4]} radius={0.1} smoothness={3}>
        <meshStandardMaterial color="#0b111c" emissive={col} emissiveIntensity={0.15} metalness={0.4} roughness={0.5} />
      </RoundedBox>
      {ys.flatMap((y, ri) =>
        xs.map((cx, ci) => (
          <mesh key={`c${ri}${ci}`} position={[cx - x, y, 0.22]}>
            <boxGeometry args={[0.22, 0.22, 0.06]} />
            <meshStandardMaterial color={col} emissive={col} emissiveIntensity={0.6} />
          </mesh>
        ))
      )}
    </group>
  );
}

function NUMAContent({ threads, numaAware }: { threads: number; numaAware: boolean }) {
  const remoteThreads = numaAware ? 0 : Math.max(0, threads - NODE_SIZE);
  const label0 = "Socket 0";
  const label1 = "Socket 1";

  return (
    <>
      {/* Memory boxes */}
      <mesh position={[-3.2, 0.9, 0]}>
        <boxGeometry args={[1.4, 0.3, 0.3]} />
        <meshStandardMaterial color="#0b111c" emissive={GREEN} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[3.2, 0.9, 0]}>
        <boxGeometry args={[1.4, 0.3, 0.3]} />
        <meshStandardMaterial color="#0b111c" emissive={numaAware ? GREEN : (remoteThreads > 0 ? RED : AMBER)} emissiveIntensity={0.4} />
      </mesh>

      {/* Sockets */}
      <Socket x={-2.8} cores={Math.min(threads, NODE_SIZE)} label={label0} col={GREEN} />
      <Socket x={2.8} cores={Math.max(0, threads - NODE_SIZE)} label={label1} col={numaAware ? GREEN : (remoteThreads > 0 ? RED : "#333")} />

      {/* Inter-socket link */}
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.03, 0.03, 2.6, 6]} />
        <meshStandardMaterial color="#1c2940" emissive={remoteThreads > 0 ? RED : "#1c2940"} emissiveIntensity={remoteThreads > 0 ? 0.8 : 0.2} />
      </mesh>

      {/* Local access packets (green) */}
      {Array.from({ length: 3 }).map((_, i) => (
        <Packet key={`loc${i}`} from={[-2.8, 0.5, 0]} to={[-3.2, 0.75, 0]} phase={i / 3} col={GREEN} />
      ))}

      {/* Remote access packets (red) when NUMA-unaware and threads > 12 */}
      {remoteThreads > 0 && Array.from({ length: 3 }).map((_, i) => (
        <Packet key={`rem${i}`} from={[2.8, 0.5, 0]} to={[-3.2, 0.75, 0]} phase={i / 3 + 0.15} col={RED} />
      ))}
    </>
  );
}

export default function NUMAScene3D({ result }: { result: ExperimentResult | null }) {
  const threads   = (result?.current?.x as number) ?? 24;
  const numaAware = (result?.params?.numaAware as boolean) ?? false;
  const remoteThreads = numaAware ? 0 : Math.max(0, threads - NODE_SIZE);
  const col = remoteThreads > 0 ? RED : GREEN;
  return (
    <Scene3DShell
      caption={numaAware ? "NUMA-aware: all accesses local (green)" : remoteThreads > 0 ? `${remoteThreads} threads crossing socket boundary → remote penalty` : "threads on socket 0 — no remote penalty yet"}
      captionColor={col}
      camera={{ position: [0, 1.2, 10], fov: 48 }}
    >
      <NUMAContent threads={threads} numaAware={numaAware} />
    </Scene3DShell>
  );
}
