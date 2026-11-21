/**
 * The AR overlay: transparent GL canvas laid exactly over the camera preview.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import * as THREE from 'three';
import FlowPath from './FlowPath';
import { Placed, Battery3D, Bulb3D, Resistor3D, Led3D, Switch3D } from './models';

function WireSegment({ a, b, live }) {
  const [x0, y0] = a;
  const [x1, y1] = b;
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1) return null;
  return (
    <mesh position={[(x0 + x1) / 2, (y0 + y1) / 2, 0]} rotation={[0, 0, Math.atan2(y1 - y0, x1 - x0)]}>
      <boxGeometry args={[len + 4, 4, 2]} />
      <meshBasicMaterial color={live ? '#3dffb5' : '#7d8597'} transparent opacity={live ? 0.55 : 0.35} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function ComponentModel({ c, res, toWorld, brightness, selected }) {
  const a = toWorld(c.terminals[0]);
  const b = toWorld(c.terminals[1]);
  const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let angle = Math.atan2(a[1] - b[1], a[0] - b[0]) - Math.PI / 2; // +Y -> terminal a
  if (c.flipped && (c.type === 'battery' || c.type === 'led')) angle += Math.PI;

  let model = null;
  switch (c.type) {
    case 'battery': model = <Battery3D state={res?.state} />; break;
    case 'bulb': model = <Bulb3D brightness={brightness} />; break;
    case 'resistor': model = <Resistor3D ohms={c.value} heat={Math.min(1, Math.max(0, ((res?.power || 0) - 0.25) / 2))} />; break;
    case 'led': model = <Led3D state={res?.state} />; break;
    case 'switch': model = <Switch3D closed={c.closed !== false} />; break;
    default: return null;
  }
  const ringR = Math.max(len, 44) * 0.58;
  return (
    <group>
      {selected && (
        <mesh position={[mid[0], mid[1], 2]}>
          <ringGeometry args={[ringR, ringR + 3.5, 40]} />
          <meshBasicMaterial color="#4de1ff" transparent opacity={0.85} depthWrite={false} />
        </mesh>
      )}
      <Placed target={mid} angle={angle} length={Math.max(len, 40)} bob={c.type === 'bulb' ? 3 : 1.5}>
        {model}
      </Placed>
    </group>
  );
}

class Scene3DErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err) {
    console.warn('Scene3D canvas error suppressed:', err);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function Scene3D({ components, solution, segments, toWorld, electronMode, selectedId }) {
  const bulbPowers = components.filter((c) => c.type === 'bulb').map((c) => solution?.elements?.[c.id]?.power || 0);
  const maxBulb = Math.max(1e-9, ...bulbPowers);
  const running = solution?.status === 'closed';

  const wirePaths = useMemo(
    () => segments.map((s) => ({ pts: s.points.map(toWorld), flow: s.flow })),
    [segments, toWorld]
  );

  return (
    <Scene3DErrorBoundary>
      <Canvas
        style={StyleSheet.absoluteFill}
        orthographic
        camera={{ zoom: 1, position: [0, 0, 1000], near: 0.1, far: 5000 }}
        gl={{ alpha: true, antialias: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <ambientLight intensity={0.9} />
        <directionalLight position={[-300, 500, 800]} intensity={2.2} />
        <directionalLight position={[300, -200, 400]} intensity={0.6} color="#88aaff" />

        {wirePaths.map((w, i) => (
          <group key={`w${i}`}>
            {w.pts.slice(1).map((p, j) => (
              <WireSegment key={j} a={w.pts[j]} b={p} live={running && Math.abs(w.flow) > 1e-6} />
            ))}
            {running && <FlowPath points={w.pts} current={w.flow} electronMode={electronMode} />}
          </group>
        ))}

        {components.map((c) => {
          const res = solution?.elements?.[c.id];
          const brightness = running && c.type === 'bulb' ? (res?.power || 0) / maxBulb : 0;
          return (
            <group key={c.id}>
              <ComponentModel c={c} res={res} toWorld={toWorld} brightness={brightness} selected={c.id === selectedId} />
              {running && (
                <FlowPath
                  points={[toWorld(c.terminals[0]), toWorld(c.terminals[1])]}
                  current={res?.current || 0}
                  electronMode={electronMode}
                  z={45}
                  radius={2.4}
                />
              )}
            </group>
          );
        })}
      </Canvas>
    </Scene3DErrorBoundary>
  );
}
