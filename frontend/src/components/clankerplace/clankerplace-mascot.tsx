"use client";

import * as React from "react";
import { RoundedBox, Capsule } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type ClankerplaceMascotProps = {
  scale?: number;
  animation?: "idle" | "none";
  lookAtPointer?: boolean;
};

export function ClankerplaceMascot({ scale = 1, animation = "idle", lookAtPointer = false }: ClankerplaceMascotProps) {
  const root = React.useRef<THREE.Group>(null);
  const head = React.useRef<THREE.Group>(null);
  const phase = React.useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    if (!root.current || !head.current) return;
    if (animation === "idle") {
      root.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.72 + phase) * 0.025;
      root.current.position.y = Math.sin(state.clock.elapsedTime * 0.92 + phase) * 0.035;
    }
    if (lookAtPointer) {
      head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, state.pointer.x * 0.16, 0.06);
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, -state.pointer.y * 0.1, 0.06);
    }
  });

  return (
    <group ref={root} scale={scale}>
      <group ref={head} position={[0, 1.28, 0]}>
        <RoundedBox args={[2.7, 1.84, 1.34]} radius={0.3} smoothness={4} castShadow>
          <meshPhysicalMaterial color="#181818" metalness={0.07} roughness={0.31} clearcoat={0.62} clearcoatRoughness={0.16} />
        </RoundedBox>
        <RoundedBox args={[2.24, 1.34, 0.09]} radius={0.22} smoothness={4} position={[0, 0, 0.69]}>
          <meshPhysicalMaterial color="#000000" metalness={0.03} roughness={0.14} clearcoat={1} />
        </RoundedBox>
        <mesh position={[-0.47, 0.08, 0.755]}><sphereGeometry args={[0.11, 20, 20]} /><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.28} /></mesh>
        <mesh position={[0.47, 0.08, 0.755]}><sphereGeometry args={[0.11, 20, 20]} /><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.28} /></mesh>
        <mesh position={[0, 0.08, 0.75]}><boxGeometry args={[0.82, 0.035, 0.035]} /><meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.18} /></mesh>
        <mesh position={[1.5, 0.12, -0.16]} rotation={[0, 0.2, -0.08]}>
          <extrudeGeometry args={[finShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04 }]} />
          <meshPhysicalMaterial color="#111111" roughness={0.35} clearcoat={0.5} />
        </mesh>
      </group>
      <Capsule args={[0.47, 0.62, 8, 20]} position={[0, -0.12, 0]} castShadow>
        <meshPhysicalMaterial color="#111111" metalness={0.05} roughness={0.4} clearcoat={0.46} />
      </Capsule>
      <Capsule args={[0.17, 0.64, 6, 14]} position={[-0.63, -0.08, 0]} rotation={[0, 0, -0.16]} castShadow><meshPhysicalMaterial color="#151515" roughness={0.38} clearcoat={0.42} /></Capsule>
      <Capsule args={[0.17, 0.64, 6, 14]} position={[0.63, -0.08, 0]} rotation={[0, 0, 0.16]} castShadow><meshPhysicalMaterial color="#151515" roughness={0.38} clearcoat={0.42} /></Capsule>
      <Capsule args={[0.2, 0.46, 6, 14]} position={[-0.28, -0.86, 0]} castShadow><meshPhysicalMaterial color="#101010" roughness={0.42} /></Capsule>
      <Capsule args={[0.2, 0.46, 6, 14]} position={[0.28, -0.86, 0]} castShadow><meshPhysicalMaterial color="#101010" roughness={0.42} /></Capsule>
    </group>
  );
}

const finShape = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(-0.1, -0.55);
  shape.lineTo(0.62, -0.1);
  shape.lineTo(0.72, 0.48);
  shape.lineTo(-0.1, 0.28);
  shape.closePath();
  return shape;
})();
