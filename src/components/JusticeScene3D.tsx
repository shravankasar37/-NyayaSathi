"use client";

// Holographic scales of justice with an Ashoka Chakra, drawn procedurally (no model files).
// The scene follows the agents: idle = slow sway; weighing = the beam tips while the case is researched;
// verdict = scales level, green glow (amber when the matter is refused or needs review).
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type SceneState = "idle" | "weighing" | "verdict" | "warning";

const SPOKES = 24;

function Chakra({ color, state }: { color: string; state: SceneState }) {
  const ref = useRef<THREE.Group>(null);
  const spokes = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < SPOKES; i++) {
      const a = (i / SPOKES) * Math.PI * 2;
      pts.push(0, 0, 0, Math.cos(a) * 1.55, Math.sin(a) * 1.55, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.z -= dt * (state === "weighing" ? 1.4 : 0.15);
  });
  return (
    <group ref={ref} position={[0, 0.55, -1.2]}>
      <mesh>
        <torusGeometry args={[1.6, 0.025, 8, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.55} />
      </mesh>
      <mesh>
        <torusGeometry args={[0.22, 0.02, 8, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      <lineSegments geometry={spokes}>
        <lineBasicMaterial color={color} transparent opacity={0.35} />
      </lineSegments>
    </group>
  );
}

function Pan({ color, glow }: { color: string; glow: string }) {
  // three chains from the hook down to a shallow dish; the group is kept level by its parent
  const chains = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      pts.push(0, 0, 0, Math.cos(a) * 0.42, -0.95, Math.sin(a) * 0.42);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <group>
      <lineSegments geometry={chains}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <mesh position={[0, -1.0, 0]}>
        <cylinderGeometry args={[0.5, 0.32, 0.12, 32, 1, true]} />
        <meshBasicMaterial color={glow} wireframe />
      </mesh>
      <mesh position={[0, -1.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.32, 32]} />
        <meshBasicMaterial color={glow} transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Scales({ ink, accent, glow, state }: { ink: string; accent: string; glow: string; state: SceneState }) {
  const root = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const tilt = useRef(0);

  useFrame(({ clock }, dt) => {
    const t = clock.getElapsedTime();
    const target = state === "weighing" ? Math.sin(t * 1.7) * 0.28 : state === "idle" ? Math.sin(t * 0.6) * 0.05 : 0;
    tilt.current += (target - tilt.current) * Math.min(1, dt * 4);
    if (beam.current) beam.current.rotation.z = tilt.current;
    // pans hang straight down whatever the beam does
    if (left.current) left.current.rotation.z = -tilt.current;
    if (right.current) right.current.rotation.z = -tilt.current;
    if (root.current) root.current.rotation.y = Math.sin(t * 0.35) * 0.55;
  });

  return (
    <group ref={root} position={[0, -0.35, 0]}>
      {/* base and pillar */}
      <mesh position={[0, -1.55, 0]}>
        <cylinderGeometry args={[0.9, 1.05, 0.18, 6]} />
        <meshBasicMaterial color={ink} wireframe />
      </mesh>
      <mesh position={[0, -1.6, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.25, 0.02, 8, 64]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.07, 0.11, 2.6, 8]} />
        <meshBasicMaterial color={ink} wireframe />
      </mesh>
      <mesh position={[0, 1.18, 0]}>
        <octahedronGeometry args={[0.16, 0]} />
        <meshBasicMaterial color={accent} wireframe />
      </mesh>
      {/* beam + pans */}
      <group ref={beam} position={[0, 1.0, 0]}>
        <mesh>
          <boxGeometry args={[3.0, 0.06, 0.06]} />
          <meshBasicMaterial color={ink} />
        </mesh>
        <group ref={left} position={[-1.45, 0, 0]}>
          <Pan color={ink} glow={glow} />
        </group>
        <group ref={right} position={[1.45, 0, 0]}>
          <Pan color={ink} glow={glow} />
        </group>
      </group>
    </group>
  );
}

function Dust({ color }: { color: string }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const n = 140;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 7;
      p[i * 3 + 1] = (Math.random() - 0.5) * 4.5;
      p[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.04;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color={color} size={0.03} transparent opacity={0.6} />
    </points>
  );
}

export default function JusticeScene3D({ state, dark }: { state: SceneState; dark: boolean }) {
  const ink = dark ? "#e8eaf0" : "#141722";
  const accent = dark ? "#00e5ff" : "#00b8d4";
  const glow = state === "verdict" ? "#00c566" : state === "warning" ? "#f59e0b" : "#ff5500";
  return (
    <Canvas camera={{ position: [0, 0.3, 5.6], fov: 45 }} gl={{ alpha: true, antialias: true }} dpr={[1, 2]} aria-label="3D scales of justice">
      <Chakra color={state === "verdict" ? "#00c566" : "#ff1a40"} state={state} />
      <Scales ink={ink} accent={accent} glow={glow} state={state} />
      <Dust color={accent} />
    </Canvas>
  );
}
