import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, MeshDistortMaterial, Float } from '@react-three/drei';
import * as THREE from 'three';

function AnimatedSpheres() {
  const sphere1Ref = useRef<THREE.Mesh>(null);
  const sphere2Ref = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (sphere1Ref.current) {
      sphere1Ref.current.position.x = Math.sin(t * 0.3) * 4;
      sphere1Ref.current.position.y = Math.cos(t * 0.2) * 3;
    }
    if (sphere2Ref.current) {
      sphere2Ref.current.position.x = Math.cos(t * 0.4) * -5;
      sphere2Ref.current.position.y = Math.sin(t * 0.3) * -3;
    }
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} />
      <pointLight position={[-10, -10, -5]} intensity={1.5} color="#6366f1" />

      <Float speed={2} rotationIntensity={1} floatIntensity={1.5}>
        <Sphere ref={sphere1Ref} args={[2.5, 64, 64]} position={[0, 0, -5]}>
          <MeshDistortMaterial
            color="#4f46e5"
            attach="material"
            distort={0.4}
            speed={2}
            roughness={0.2}
            metalness={0.8}
          />
        </Sphere>
      </Float>

      <Float speed={3} rotationIntensity={1.5} floatIntensity={2}>
        <Sphere ref={sphere2Ref} args={[1.8, 64, 64]} position={[4, 2, -7]}>
          <MeshDistortMaterial
            color="#ec4899"
            attach="material"
            distort={0.5}
            speed={3}
            roughness={0.3}
            metalness={0.7}
          />
        </Sphere>
      </Float>

      <Float speed={1.5} rotationIntensity={0.8} floatIntensity={1}>
        <Sphere args={[2, 64, 64]} position={[-4, -2, -8]}>
          <MeshDistortMaterial
            color="#8b5cf6"
            attach="material"
            distort={0.3}
            speed={1.5}
            roughness={0.1}
            metalness={0.9}
          />
        </Sphere>
      </Float>
    </>
  );
}

export default function ThreeBackground() {
  return (
    <div className="absolute inset-0 -z-10 pointer-events-none bg-slate-950 overflow-hidden">
      <Canvas camera={{ position: [0, 0, 10], fov: 60 }}>
        <AnimatedSpheres />
      </Canvas>
      <div className="absolute inset-0 bg-gradient-to-tr from-slate-950/90 via-slate-900/60 to-slate-950/90 backdrop-blur-[2px]" />
    </div>
  );
}
