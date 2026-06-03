"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import type * as THREE from "three";
import type { ExperimentResult } from "@vhpce/profile-schema";

const BAD = "#ff5d73";
const GOOD = "#3ddc97";

// horizontal x-positions for n cores, centered
function coreXs(n: number): number[] {
  const span = Math.min(10, n * 0.85);
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));
}

function Cores({ n, padded }: { n: number; padded: boolean }) {
  const mats = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const owner = Math.floor(t / 0.4) % n;
    for (let i = 0; i < n; i++) {
      const m = mats.current[i];
      if (!m) continue;
      const target = padded
        ? 0.4 + 0.22 * Math.sin(t * 2 + i)
        : i === owner ? 1.4 + 0.4 * Math.sin(t * 14) : 0.08;
      m.emissiveIntensity += (target - m.emissiveIntensity) * 0.25;
    }
  });
  return (
    <>
      {coreXs(n).map((x, i) => (
        <RoundedBox key={i} args={[0.6, 0.4, 0.42]} radius={0.07} smoothness={3} position={[x, 1.5, 0]}>
          <meshStandardMaterial
            ref={(el) => { mats.current[i] = el as THREE.MeshStandardMaterial | null; }}
            color="#0b111c" emissive={padded ? GOOD : BAD} emissiveIntensity={0.2}
            metalness={0.4} roughness={0.35}
          />
        </RoundedBox>
      ))}
    </>
  );
}

function SharedLine({ n }: { n: number }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (matRef.current) matRef.current.emissiveIntensity = 0.55 + 0.45 * Math.abs(Math.sin(clock.getElapsedTime() * 6));
  });
  const span = Math.min(10, n * 0.85) + 0.9;
  return (
    <RoundedBox args={[span, 0.42, 0.55]} radius={0.09} smoothness={3} position={[0, -0.35, 0]}>
      <meshStandardMaterial ref={matRef} color="#160a0e" emissive={BAD} emissiveIntensity={0.6} metalness={0.3} roughness={0.45} />
    </RoundedBox>
  );
}

function PaddedLines({ n }: { n: number }) {
  return (
    <>
      {coreXs(n).map((x, i) => (
        <RoundedBox key={i} args={[0.5, 0.32, 0.55]} radius={0.06} smoothness={3} position={[x, -0.35, 0]}>
          <meshStandardMaterial color="#0a140f" emissive={GOOD} emissiveIntensity={0.4} metalness={0.3} roughness={0.45} />
        </RoundedBox>
      ))}
    </>
  );
}

// The coherence packet: rises from the line to whichever core currently owns it,
// jumping columns each cycle — the cache line ping-ponging across cores.
function Packet({ n }: { n: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const xs = coreXs(n);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const owner = Math.floor(t / 0.4) % n;
    const ph = (t % 0.4) / 0.4;
    ref.current.position.set(xs[owner], -0.35 + ph * 1.85, 0);
    const s = 1 + 0.5 * Math.sin(t * 20);
    ref.current.scale.setScalar(s);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.12, 16, 16]} />
      <meshStandardMaterial color="#ffffff" emissive={BAD} emissiveIntensity={2.2} />
    </mesh>
  );
}

function Rig({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (g.current) g.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.25) * 0.16; });
  return <group ref={g}>{children}</group>;
}

export default function FalseSharingScene3D({ result }: { result: ExperimentResult | null }) {
  const n = Math.min((result?.params?.threads as number) ?? 24, 16);
  const padded = !!result?.params?.padded;
  return (
    <div
      style={{
        position: "relative", width: "100%", flex: 1, minHeight: 340, borderRadius: 10, overflow: "hidden",
        border: "1px solid #15202f",
        background: "radial-gradient(600px 300px at 50% 0%, rgba(76,201,240,.06), transparent 70%), #070a10",
      }}
    >
      <Canvas camera={{ position: [0, 0.6, 7.6], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 4]} intensity={2.4} />
        <Rig>
          <Cores n={n} padded={padded} />
          {padded ? <PaddedLines n={n} /> : (<><SharedLine n={n} /><Packet n={n} /></>)}
        </Rig>
      </Canvas>
      <div
        style={{
          position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center",
          fontSize: 12, fontWeight: 600, color: padded ? GOOD : BAD, pointerEvents: "none",
          textShadow: "0 0 8px rgba(0,0,0,.6)",
        }}
      >
        {padded
          ? "Each counter on its OWN cache line — no cross-core invalidation"
          : "ONE shared cache line — invalidated on every write → ping-pongs across cores"}
      </div>
    </div>
  );
}
