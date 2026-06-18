"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";
import { Scene3DShell } from "./Shell";

const GREEN = "#3ddc97";
const RED   = "#ff5d73";
const AMBER = "#ffb454";

function TaskNode({ pos, size, depth }: { pos: [number, number, number]; size: number; depth: number }) {
  const cols = ["#4cc9f0", "#5eb8ff", "#7b6cf6"];
  return (
    <mesh position={pos}>
      <boxGeometry args={[size, size * 0.5, 0.18]} />
      <meshStandardMaterial color="#0b111c" emissive={cols[depth % cols.length]} emissiveIntensity={0.8} />
    </mesh>
  );
}

function WorkerSphere({ workerIdx, numWorkers: _numWorkers, taskPositions, coarse }: { workerIdx: number; numWorkers: number; taskPositions: [number, number, number][]; coarse: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const speed = coarse ? 0.4 : 1.8;
  useFrame(({ clock }) => {
    if (!ref.current || taskPositions.length === 0) return;
    const t = clock.getElapsedTime() * speed + workerIdx * 1.3;
    const idx = Math.floor(t) % taskPositions.length;
    const frac = t - Math.floor(t);
    const a = taskPositions[idx];
    const b = taskPositions[(idx + 1) % taskPositions.length];
    ref.current.position.set(
      a[0] + frac * (b[0] - a[0]),
      a[1] + frac * (b[1] - a[1]) + Math.sin(frac * Math.PI) * 0.3,
      0.3,
    );
  });
  const col = coarse ? GREEN : AMBER;
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.15, 10, 10]} />
      <meshStandardMaterial color={col} emissive={col} emissiveIntensity={1.5} />
    </mesh>
  );
}

const COARSE_TASKS: [number, number, number][] = [
  [-2.5, 1.2, 0], [0, 1.2, 0], [2.5, 1.2, 0],
  [-1.2, -0.2, 0], [1.2, -0.2, 0],
];

const FINE_TASKS: [number, number, number][] = [
  [-3, 1.6, 0], [-1.5, 1.6, 0], [0, 1.6, 0], [1.5, 1.6, 0], [3, 1.6, 0],
  [-2.2, 0.3, 0], [-0.7, 0.3, 0], [0.7, 0.3, 0], [2.2, 0.3, 0],
  [-1.5, -1.0, 0], [0, -1.0, 0], [1.5, -1.0, 0],
];

function TaskContent({ threads, coarse }: { threads: number; coarse: boolean }) {
  const tasks = coarse ? COARSE_TASKS : FINE_TASKS;
  const workers = Math.min(threads, 8);
  return (
    <>
      {tasks.map((pos, i) => (
        <TaskNode key={i} pos={pos} size={coarse ? 0.9 : 0.48} depth={i % 3} />
      ))}
      {/* Tree edges */}
      {coarse && (
        <>
          <mesh position={[-1.25, 1.2, -0.1]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, 2.5, 6]} />
            <meshStandardMaterial color="#1c2940" />
          </mesh>
          <mesh position={[1.25, 1.2, -0.1]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.02, 0.02, 2.5, 6]} />
            <meshStandardMaterial color="#1c2940" />
          </mesh>
        </>
      )}
      {Array.from({ length: workers }).map((_, i) => (
        <WorkerSphere key={i} workerIdx={i} numWorkers={workers} taskPositions={tasks} coarse={coarse} />
      ))}
    </>
  );
}

export default function OpenmpTasksScene3D({ result }: { result: ExperimentResult | null }) {
  const threads = (result?.current?.x as number) ?? 8;
  const gran    = (result?.params?.granularity as string) ?? "fine";
  const coarse  = gran === "coarse";
  const col     = coarse ? GREEN : RED;
  return (
    <Scene3DShell
      caption={coarse ? "coarse tasks — workers busy, low scheduler overhead" : "fine tasks — workers overwhelm the task queue"}
      captionColor={col}
      camera={{ position: [0, 0.5, 10], fov: 46 }}
    >
      <TaskContent threads={threads} coarse={coarse} />
    </Scene3DShell>
  );
}
