/**
 * Animated current-flow particles along a polyline (instanced spheres).
 */
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import * as THREE from 'three';

const SPACING = 26;

export function flowSpeed(current) {
  const a = Math.abs(current);
  if (a < 1e-6) return 0;
  return 35 + 165 * Math.min(1, Math.log10(1 + a * 1000) / 3.5); // px / s
}

export default function FlowPath({ points, current, electronMode, z = 4, radius = 3.2 }) {
  const mesh = useRef();
  const offset = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { segs, total } = useMemo(() => {
    const out = [];
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      const len = Math.hypot(x1 - x0, y1 - y0);
      out.push({ x0, y0, x1, y1, len, start: acc });
      acc += len;
    }
    return { segs: out, total: acc };
  }, [points]);

  const count = Math.max(1, Math.floor(total / SPACING));
  const sign = (electronMode ? -1 : 1) * Math.sign(current);
  const speed = flowSpeed(current);

  useFrame((state, dt) => {
    const m = mesh.current;
    if (!m) return;
    offset.current = (offset.current + sign * speed * Math.min(dt, 0.05) + SPACING * 1000) % SPACING;
    let si = 0;
    for (let k = 0; k < count; k++) {
      const s = offset.current + k * SPACING;
      if (speed === 0 || s > total) {
        dummy.scale.setScalar(0.0001);
      } else {
        while (si < segs.length - 1 && s > segs[si].start + segs[si].len) si++;
        const g = segs[si];
        const t = g.len ? (s - g.start) / g.len : 0;
        dummy.position.set(g.x0 + (g.x1 - g.x0) * t, g.y0 + (g.y1 - g.y0) * t, z);
        const pulse = 1 + 0.25 * Math.sin(state.clock.elapsedTime * 8 + k);
        dummy.scale.setScalar(pulse);
      }
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh key={count} ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[radius, 10, 10]} />
      <meshBasicMaterial color={electronMode ? '#4de1ff' : '#ffcc33'} transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
    </instancedMesh>
  );
}
