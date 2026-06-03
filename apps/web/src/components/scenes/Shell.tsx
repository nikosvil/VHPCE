"use client";

import { useRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type * as THREE from "three";

function Rig({ children }: { children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (g.current) g.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.22) * 0.1;
  });
  return <group ref={g}>{children}</group>;
}

export function Scene3DShell({
  caption,
  captionColor,
  camera,
  children,
}: {
  caption: string;
  captionColor: string;
  camera?: { position: [number, number, number]; fov: number };
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative", width: "100%", flex: 1, minHeight: 340, borderRadius: 10, overflow: "hidden",
        border: "1px solid #15202f",
        background: "radial-gradient(600px 300px at 50% 0%, rgba(76,201,240,.06), transparent 70%), #070a10",
      }}
    >
      <Canvas camera={camera ?? { position: [0, 0.6, 7.6], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 4]} intensity={2.4} />
        <Rig>{children}</Rig>
      </Canvas>
      <div
        style={{
          position: "absolute", bottom: 10, left: 0, right: 0, textAlign: "center",
          fontSize: 12, fontWeight: 600, color: captionColor, pointerEvents: "none",
          textShadow: "0 0 8px rgba(0,0,0,.6)",
        }}
      >
        {caption}
      </div>
    </div>
  );
}

// shared layout helper: centered x-positions for n items
export function laneXs(n: number, spanMax = 10): number[] {
  const span = Math.min(spanMax, n * 0.8);
  return Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -span / 2 + (span * i) / (n - 1)));
}
