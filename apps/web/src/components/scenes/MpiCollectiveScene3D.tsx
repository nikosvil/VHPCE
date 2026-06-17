"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const AMBER = "#ffb454";
const RED   = "#ff5d73";
const CYAN  = "#4cc9f0";

function collectiveColor(c: string) {
  if (c === "broadcast" || c === "reduce") return GREEN;
  if (c === "allreduce") return AMBER;
  return RED;
}

function Packet({ from, to, speed, phase, col }: { from: [number, number]; to: [number, number]; speed: number; phase: number; col: string }) {
  const [fx, fy] = from;
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.getElapsedTime() * speed + phase) % 1 + 1) % 1;
    ref.current.position.set(fx + t * (to[0] - fx), fy + t * (to[1] - fy), 0.3);
    ref.current.scale.setScalar(0.5 + 0.5 * Math.sin(t * Math.PI));
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.1, 8, 8]} />
      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.8} />
    </mesh>
  );
}

function CollectiveContent({ ranks, collective }: { ranks: number; collective: string }) {
  const n = Math.min(ranks, 10);
  const R = 2.6;
  const positions: [number, number][] = Array.from({ length: n }, (_, i) => {
    const ang = (2 * Math.PI * i) / n - Math.PI / 2;
    return [R * Math.cos(ang), R * Math.sin(ang)];
  });
  const col = collectiveColor(collective);

  // Build packets based on collective type
  const packets: { from: [number, number]; to: [number, number]; phase: number }[] = [];
  if (collective === "broadcast") {
    // Root (0) sends to each rank in a tree: 0→1, 0→2, 1→3, 2→4 (simplified)
    [[0,1],[0,2],[1,3],[2,4],[3,5],[4,6]].forEach(([a,b], i) => {
      if (a < n && b < n) packets.push({ from: positions[a], to: positions[b], phase: i * 0.15 });
    });
  } else if (collective === "reduce") {
    // Reverse tree: all → root
    [[1,0],[2,0],[3,1],[4,2],[5,3],[6,4]].forEach(([a,b], i) => {
      if (a < n && b < n) packets.push({ from: positions[a], to: positions[b], phase: i * 0.15 });
    });
  } else if (collective === "allreduce") {
    // Ring: each sends to next
    for (let i = 0; i < Math.min(n, 6); i++) {
      packets.push({ from: positions[i], to: positions[(i + 1) % n], phase: i / n });
    }
  } else {
    // alltoall: every rank sends to every other — show a subset
    for (let i = 0; i < Math.min(n, 5); i++) {
      for (let j = 0; j < Math.min(n, 5); j++) {
        if (i !== j) packets.push({ from: positions[i], to: positions[j], phase: (i * n + j) / (n * n) });
      }
    }
  }

  return (
    <>
      {/* Ring connections */}
      {positions.map((p, i) => {
        const q = positions[(i + 1) % n];
        const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]);
        return (
          <mesh key={"e" + i} position={[mx, my, 0]} rotation={[0, 0, ang + Math.PI / 2]}>
            <cylinderGeometry args={[0.015, 0.015, len, 5]} />
            <meshStandardMaterial color="#1c2940" />
          </mesh>
        );
      })}

      {/* Rank nodes */}
      {positions.map(([x, y], i) => (
        <RoundedBox key={"r" + i} args={[0.55, 0.55, 0.3]} radius={0.08} smoothness={3} position={[x, y, 0]}>
          <meshStandardMaterial color="#0b111c" emissive={i === 0 && (collective === "broadcast" || collective === "reduce") ? "#4cc9f0" : col} emissiveIntensity={0.5} metalness={0.3} roughness={0.4} />
        </RoundedBox>
      ))}

      {/* Animated packets */}
      {packets.map((p, i) => (
        <Packet key={i} from={p.from} to={p.to} speed={collective === "alltoall" ? 1.6 : 0.8} phase={p.phase} col={col} />
      ))}
    </>
  );
}

export default function MpiCollectiveScene3D({ result }: { result: ExperimentResult | null }) {
  const ranks      = (result?.current?.x as number) ?? 8;
  const collective = (result?.params?.collective as string) ?? "alltoall";
  const col        = collectiveColor(collective);
  const caption =
    collective === "broadcast"  ? `Broadcast: root → all in O(log₂ ${ranks}) steps` :
    collective === "reduce"     ? `Reduce: all → root in O(log₂ ${ranks}) steps` :
    collective === "allreduce"  ? `Allreduce: ring, O(log p) cost — efficient` :
                                  `Alltoall: O(p) messages — grows with ${ranks} ranks`;
  return (
    <Scene3DShell caption={caption} captionColor={col} camera={{ position: [0, 0.5, 10], fov: 46 }}>
      <CollectiveContent ranks={ranks} collective={collective} />
    </Scene3DShell>
  );
}
