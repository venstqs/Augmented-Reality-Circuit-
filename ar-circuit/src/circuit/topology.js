/**
 * Circuit topology helpers.
 *
 * Coordinates are NORMALIZED image coordinates (0..1) so the same circuit
 * description works for demo layouts and for camera detections.
 */

export const DEFAULT_VALUES = {
  battery: 9, // volts
  resistor: 10, // ohms
  bulb: 12, // ohms
  led: 0, // modelled internally
  switch: 0,
};

export const UNITS = { battery: 'V', resistor: 'Ω', bulb: 'Ω', led: '', switch: '' };

/** Terminal points at the two ends of the component's long axis. */
export function terminalsFromBox(box) {
  const vertical = box.h >= box.w;
  if (vertical) {
    return {
      vertical,
      terminals: [
        { x: box.x + box.w / 2, y: box.y },
        { x: box.x + box.w / 2, y: box.y + box.h },
      ],
    };
  }
  return {
    vertical,
    terminals: [
      { x: box.x, y: box.y + box.h / 2 },
      { x: box.x + box.w, y: box.y + box.h / 2 },
    ],
  };
}

/** Turn components (with .nodes already assigned) into solver elements. */
export function toSolverElements(components) {
  return components.map((c) => ({
    id: c.id,
    type: c.type,
    value: c.value,
    closed: c.closed,
    flipped: c.flipped,
    label: c.label,
    nodes: c.nodes,
  }));
}

/**
 * Build drawable wire segments with signed current flow for animation.
 * For every net the terminals are chained (nearest neighbour); the flow on
 * each chain edge follows from KCL: cumulative sum of the currents injected
 * by the terminals before it.
 * Returns [{ points: [{x,y}...], flow }] where flow > 0 means current moves
 * along the points in order (conventional current).
 */
export function buildWireSegments(components, solution) {
  const nets = new Map();
  for (const c of components) {
    const I = solution?.elements?.[c.id]?.current ?? 0; // a -> b through element
    c.terminals.forEach((pt, t) => {
      const net = c.nodes[t];
      if (!nets.has(net)) nets.set(net, []);
      // Element pulls I out of net a and pushes I into net b.
      nets.get(net).push({ pt, inj: t === 0 ? -I : I });
    });
  }

  const segments = [];
  for (const terms of nets.values()) {
    if (terms.length < 2) continue;
    // Nearest-neighbour chain starting from the left/top-most terminal.
    const rest = [...terms].sort((p, q) => p.pt.x + p.pt.y - (q.pt.x + q.pt.y));
    const chain = [rest.shift()];
    while (rest.length) {
      const last = chain[chain.length - 1].pt;
      let bi = 0;
      let bd = Infinity;
      rest.forEach((r, i) => {
        const d = Math.abs(r.pt.x - last.x) + Math.abs(r.pt.y - last.y);
        if (d < bd) { bd = d; bi = i; }
      });
      chain.push(rest.splice(bi, 1)[0]);
    }
    let cumulative = 0;
    for (let k = 0; k < chain.length - 1; k++) {
      cumulative += chain[k].inj;
      const p0 = chain[k].pt;
      const p1 = chain[k + 1].pt;
      const points =
        Math.abs(p0.x - p1.x) < 1e-3 || Math.abs(p0.y - p1.y) < 1e-3
          ? [p0, p1]
          : [p0, { x: p1.x, y: p0.y }, p1]; // Manhattan routing
      segments.push({ points, flow: cumulative });
    }
  }
  return segments;
}

/** Pretty number formatting with engineering units. */
export function fmt(value, unit) {
  const a = Math.abs(value);
  if (a === 0) return `0 ${unit}`;
  if (a < 1e-3) return `${(value * 1e6).toFixed(0)} µ${unit}`;
  if (a < 1) return `${(value * 1e3).toFixed(1)} m${unit}`;
  return `${value.toFixed(a < 10 ? 2 : 1)} ${unit}`;
}
