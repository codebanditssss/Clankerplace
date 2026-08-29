"use client";

import * as React from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import { ClankerplaceMascot } from "./clankerplace-mascot";

const BASES: [number, number, number][] = [
  [-5.8, 2.7, -1.8], [-2.9, 3.25, -0.9], [0.25, 2.75, -1.7], [3.45, 3.2, -2.2],
  [-6.3, 0.15, -0.8], [-3.5, 0.45, 0.3], [-0.35, 0.1, -0.3], [2.7, 0.5, -0.8],
  [-5.0, -2.45, -1.5], [-1.9, -2.15, -0.2], [1.15, -2.55, -1.2], [4.0, -1.9, -2.0],
];
const SCALES = [0.56, 0.78, 0.63, 0.45, 0.82, 0.58, 0.94, 0.62, 0.47, 0.7, 0.53, 0.42];
const EDGES = [[0,1],[1,2],[2,3],[0,4],[1,5],[2,6],[3,7],[4,5],[5,6],[6,7],[4,8],[5,9],[6,10],[7,11],[8,9],[9,10],[10,11],[1,6],[5,10]] as const;
const COLORS = ["#ffffff", "#7de3ff", "#b69cff"];

export default function AgentNetwork() {
  return (
    <Canvas aria-label="Interactive network of connected autonomous agents" dpr={[1, 1.75]} gl={{ antialias: true, powerPreference: "high-performance", alpha: false }} camera={{ position: [0, 0.3, 14], fov: 42, near: 0.1, far: 60 }}>
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.28} />
      <hemisphereLight color="#ffffff" groundColor="#000000" intensity={0.48} />
      <directionalLight position={[-5, 8, 9]} intensity={3.4} color="#ffffff" castShadow />
      <pointLight position={[-6, 1, 4]} intensity={0.9} color="#7de3ff" />
      <pointLight position={[6, 1, -1]} intensity={2.1} color="#b69cff" />
      <Network />
      <ContactShadows position={[0, -4.4, 0]} opacity={0.32} scale={18} blur={2.6} far={8} color="#ffffff" />
    </Canvas>
  );
}

function Network() {
  const refs = React.useRef<Array<THREE.Group | null>>([]);
  const [hovered, setHovered] = React.useState<number | null>(null);
  const pointerPoint = React.useRef(new THREE.Vector3());
  const { viewport } = useThree();
  const sceneScale = Math.min(1, viewport.width / 15);
  return (
    <group scale={sceneScale}>
      {EDGES.map(([from, to], index) => <Thread key={`${from}-${to}`} from={from} to={to} refs={refs} color={COLORS[index % COLORS.length]} />)}
      {BASES.map((base, index) => (
        <Agent key={index} index={index} base={base} scale={SCALES[index]} active={hovered === index} pointerPoint={pointerPoint} setRef={(node) => { refs.current[index] = node; }} onHover={setHovered} />
      ))}
    </group>
  );
}

function Agent({ index, base, scale, active, pointerPoint, setRef, onHover }: { index: number; base: [number, number, number]; scale: number; active: boolean; pointerPoint: React.RefObject<THREE.Vector3>; setRef: (node: THREE.Group | null) => void; onHover: (index: number | null) => void }) {
  const local = React.useRef<THREE.Group>(null);
  const phase = index * 0.91;
  useFrame((state) => {
    const group = local.current;
    if (!group) return;
    const t = state.clock.elapsedTime;
    const idleX = Math.sin(t * 0.33 + phase) * 0.12;
    const idleY = Math.sin(t * 0.58 + phase) * 0.12;
    const idleZ = Math.cos(t * 0.29 + phase) * 0.08;
    const orbitX = active ? Math.cos(t * 1.25) * 0.24 : 0;
    const orbitY = active ? Math.sin(t * 1.25) * 0.18 : 0;
    group.position.x = THREE.MathUtils.lerp(group.position.x, base[0] + idleX + orbitX, 0.05);
    group.position.y = THREE.MathUtils.lerp(group.position.y, base[1] + idleY + orbitY, 0.05);
    group.position.z = THREE.MathUtils.lerp(group.position.z, base[2] + idleZ + (active ? 0.55 : 0), 0.05);
    const targetScale = active ? scale * 1.16 : scale;
    group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x, targetScale, 0.08));
    group.rotation.y = Math.sin(t * 0.31 + phase) * 0.1;
    group.rotation.z = Math.cos(t * 0.27 + phase) * 0.035;
  });
  const move = (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); pointerPoint.current.copy(event.point); onHover(index); };
  return (
    <group ref={(node) => { local.current = node; setRef(node); }} position={base} scale={scale} onPointerMove={move} onPointerOver={move} onPointerOut={() => onHover(null)}>
      <ClankerplaceMascot animation="idle" lookAtPointer={active} />
      <mesh visible={false}><sphereGeometry args={[1.9, 12, 12]} /><meshBasicMaterial transparent opacity={0} /></mesh>
    </group>
  );
}

function Thread({ from, to, refs, color }: { from: number; to: number; refs: React.MutableRefObject<Array<THREE.Group | null>>; color: string }) {
  const line = React.useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 19 }, () => new THREE.Vector3()));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: color === "#ffffff" ? 0.24 : 0.38 });
    return new THREE.Line(geometry, material);
  }, [color]);
  useFrame(() => {
    const a = refs.current[from]; const b = refs.current[to];
    if (!a || !b) return;
    const start = a.position; const end = b.position;
    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    mid.z += 0.45; mid.y += Math.sin(from * 2.1 + to) * 0.22;
    const points = new THREE.QuadraticBezierCurve3(start.clone(), mid, end.clone()).getPoints(18);
    const positions = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    points.forEach((point, index) => positions.setXYZ(index, point.x, point.y, point.z));
    positions.needsUpdate = true;
  });
  React.useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return <primitive object={line} />;
}
