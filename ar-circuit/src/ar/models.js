/**
 * Procedural 3D component models for the AR overlay (React Three Fiber).
 * World units = screen pixels (orthographic camera). Each model's long axis
 * is local +Y, with terminal "a" (+ / anode / first terminal) at +Y.
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';

const TILT = -0.55; // lean models toward the viewer so they read as 3D

/** Shared wrapper: smooth position follow + pop-in + orientation. */
export function Placed({ target, angle, length, children, bob = 0 }) {
  const ref = useRef();
  const born = useRef(null);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    if (born.current == null) {
      born.current = state.clock.elapsedTime;
      g.position.set(target[0], target[1], 0);
      g.rotation.z = angle;
    }
    const k = 1 - Math.exp(-dt * 10); // frame-rate independent smoothing
    g.position.x += (target[0] - g.position.x) * k;
    g.position.y += (target[1] - g.position.y) * k;
    g.rotation.z += (angle - g.rotation.z) * k;
    const t = state.clock.elapsedTime - born.current;
    // Elastic pop-in, like a filter sticker appearing.
    const pop = t > 0.8 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(12 * t);
    const s = (length / 100) * pop;
    g.scale.setScalar(Math.max(0.001, s));
    g.position.z = 20 + Math.sin(state.clock.elapsedTime * 2) * bob;
  });
  return (
    <group ref={ref}>
      <group rotation={[TILT, 0, 0]}>{children}</group>
    </group>
  );
}

/* --------------------------------- Battery -------------------------------- */
export function Battery3D({ state }) {
  const shorted = state === 'short';
  const flash = useRef();
  useFrame(({ clock }) => {
    if (flash.current) flash.current.emissiveIntensity = shorted ? 1 + Math.sin(clock.elapsedTime * 20) : 0;
  });
  return (
    <group>
      {/* black body (negative half) */}
      <mesh position={[0, -12, 0]}>
        <cylinderGeometry args={[17, 17, 56, 32]} />
        <meshStandardMaterial ref={flash} color="#1d1f24" metalness={0.4} roughness={0.35} emissive="#ff2a00" />
      </mesh>
      {/* copper top (positive half) */}
      <mesh position={[0, 26, 0]}>
        <cylinderGeometry args={[17, 17, 20, 32]} />
        <meshStandardMaterial color="#e08a2c" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* label stripe */}
      <mesh position={[0, -6, 0]}>
        <cylinderGeometry args={[17.4, 17.4, 8, 32]} />
        <meshStandardMaterial color="#3fa9ff" emissive="#1466c0" emissiveIntensity={0.6} />
      </mesh>
      {/* + nub */}
      <mesh position={[0, 40, 0]}>
        <cylinderGeometry args={[6, 6, 8, 20]} />
        <meshStandardMaterial color="#d9d9d9" metalness={1} roughness={0.2} />
      </mesh>
      {/* - cap */}
      <mesh position={[0, -41, 0]}>
        <cylinderGeometry args={[15, 15, 3, 24]} />
        <meshStandardMaterial color="#9a9a9a" metalness={1} roughness={0.3} />
      </mesh>
    </group>
  );
}

/* ---------------------------------- Bulb ---------------------------------- */
export function Bulb3D({ brightness = 0 }) {
  const glass = useRef();
  const halo = useRef();
  const fil = useRef();
  const light = useRef();
  useFrame(({ clock }) => {
    const flicker = brightness > 0 ? 1 + Math.sin(clock.elapsedTime * 31) * 0.03 : 1;
    const b = brightness * flicker;
    if (glass.current) glass.current.emissiveIntensity = 0.05 + b * 1.6;
    if (fil.current) fil.current.emissiveIntensity = b * 4;
    if (halo.current) {
      halo.current.scale.setScalar(1 + b * 1.4);
      halo.current.material.opacity = b * 0.35;
    }
    if (light.current) light.current.intensity = b * 3;
  });
  return (
    <group>
      {/* glass */}
      <mesh position={[0, 14, 0]}>
        <sphereGeometry args={[28, 32, 32]} />
        <meshStandardMaterial
          ref={glass}
          color="#fff6d5"
          emissive="#ffc23a"
          transparent
          opacity={0.75}
          roughness={0.05}
        />
      </mesh>
      {/* filament */}
      <mesh position={[0, 14, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[8, 1.5, 8, 24, Math.PI]} />
        <meshStandardMaterial ref={fil} color="#ffb347" emissive="#ff9a1f" />
      </mesh>
      {/* neck + screw base */}
      <mesh position={[0, -18, 0]}>
        <cylinderGeometry args={[13, 15, 14, 24]} />
        <meshStandardMaterial color="#fff6d5" transparent opacity={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, -28 - i * 5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[12 - i * 0.6, 2.4, 8, 24]} />
          <meshStandardMaterial color="#b9bcc4" metalness={1} roughness={0.25} />
        </mesh>
      ))}
      <mesh position={[0, -48, 0]}>
        <sphereGeometry args={[6, 16, 16]} />
        <meshStandardMaterial color="#333" metalness={0.8} />
      </mesh>
      {/* halo glow */}
      <mesh ref={halo} position={[0, 14, 0]}>
        <sphereGeometry args={[34, 24, 24]} />
        <meshBasicMaterial color="#ffd36b" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
      <pointLight ref={light} position={[0, 14, 40]} color="#ffcf70" distance={300} decay={0} intensity={0} />
    </group>
  );
}

/* -------------------------------- Resistor -------------------------------- */
const BAND = ['#000000', '#7b3f00', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#9e9e9e', '#ffffff'];

export function resistorBands(ohms) {
  const v = Math.max(Number(ohms) || 0, 0.1);
  const exp = Math.floor(Math.log10(v)) - 1;
  const sig = Math.round(v / Math.pow(10, exp));
  const d1 = Math.min(9, Math.floor(sig / 10));
  const d2 = sig % 10;
  const mult = exp === -1 ? '#c9a227' : exp === -2 ? '#c0c0c0' : BAND[Math.max(0, Math.min(9, exp))];
  return [BAND[d1], BAND[d2], mult, '#c9a227'];
}

export function Resistor3D({ ohms, heat = 0 }) {
  const bands = useMemo(() => resistorBands(ohms), [ohms]);
  const body = useRef();
  useFrame(({ clock }) => {
    if (body.current) body.current.emissiveIntensity = heat * (0.8 + Math.sin(clock.elapsedTime * 4) * 0.2);
  });
  return (
    <group>
      <mesh>
        <capsuleGeometry args={[11, 44, 8, 24]} />
        <meshStandardMaterial ref={body} color="#d8c39a" roughness={0.6} emissive="#ff3d00" emissiveIntensity={0} />
      </mesh>
      {bands.map((c, i) => (
        <mesh key={i} position={[0, 16 - i * 10 - (i === 3 ? 4 : 0), 0]}>
          <cylinderGeometry args={[11.6, 11.6, 4, 24]} />
          <meshStandardMaterial color={c} roughness={0.4} />
        </mesh>
      ))}
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, s * 42, 0]}>
          <cylinderGeometry args={[1.6, 1.6, 22, 8]} />
          <meshStandardMaterial color="#cfd3da" metalness={1} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

/* ----------------------------------- LED ---------------------------------- */
export function Led3D({ state }) {
  const dome = useRef();
  const halo = useRef();
  const on = state === 'on' || state === 'burnt';
  useFrame(({ clock }) => {
    const burnt = state === 'burnt';
    const k = on ? (burnt ? (Math.sin(clock.elapsedTime * 25) > 0 ? 3 : 0.2) : 2.2) : 0.05;
    if (dome.current) dome.current.emissiveIntensity = k;
    if (halo.current) halo.current.material.opacity = on ? 0.35 : 0;
  });
  return (
    <group>
      <mesh position={[0, 14, 0]}>
        <sphereGeometry args={[13, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial ref={dome} color="#ff3355" emissive="#ff1744" transparent opacity={0.9} />
      </mesh>
      <mesh position={[0, 2, 0]}>
        <cylinderGeometry args={[13, 13, 24, 24]} />
        <meshStandardMaterial color="#ff3355" emissive="#ff1744" emissiveIntensity={on ? 1.2 : 0.05} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, -11, 0]}>
        <cylinderGeometry args={[15, 15, 3, 24]} />
        <meshStandardMaterial color="#ff5c77" />
      </mesh>
      {[-5, 5].map((x, i) => (
        <mesh key={x} position={[x, -30 - i * 4, 0]}>
          <cylinderGeometry args={[1.4, 1.4, 34 + i * 8, 8]} />
          <meshStandardMaterial color="#cfd3da" metalness={1} roughness={0.2} />
        </mesh>
      ))}
      <mesh ref={halo} position={[0, 10, 0]}>
        <sphereGeometry args={[30, 20, 20]} />
        <meshBasicMaterial color="#ff4d6d" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* --------------------------------- Switch --------------------------------- */
export function Switch3D({ closed }) {
  const lever = useRef();
  useFrame((_, dt) => {
    if (!lever.current) return;
    const target = closed ? 0 : 0.7;
    lever.current.rotation.z += (target - lever.current.rotation.z) * (1 - Math.exp(-dt * 12));
  });
  return (
    <group>
      <mesh>
        <boxGeometry args={[22, 90, 8]} />
        <meshStandardMaterial color="#2b2f3a" roughness={0.5} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[0, s * 36, 7]}>
          <cylinderGeometry args={[5, 5, 6, 16]} />
          <meshStandardMaterial color="#e0a84a" metalness={1} roughness={0.2} />
        </mesh>
      ))}
      {/* lever pivots at the bottom contact */}
      <group ref={lever} position={[0, -36, 10]}>
        <mesh position={[0, 36, 0]}>
          <boxGeometry args={[5, 72, 4]} />
          <meshStandardMaterial color="#cfd3da" metalness={1} roughness={0.15} />
        </mesh>
        <mesh position={[0, 66, 6]}>
          <sphereGeometry args={[6, 16, 16]} />
          <meshStandardMaterial color={closed ? '#2ee59d' : '#ff5370'} emissive={closed ? '#0f9f63' : '#c2183a'} emissiveIntensity={0.8} />
        </mesh>
      </group>
    </group>
  );
}
