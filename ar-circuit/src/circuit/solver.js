/**
 * DC circuit solver (nodal analysis).
 *
 * Every element is reduced to a Norton equivalent between nodes a and b:
 *   I_ab = (Va - Vb) * g - J
 * where J is a current source pushing current from b to a (inside the element).
 *
 *  - battery  (a = +, b = -): g = 1/r_int, J = V / r_int
 *  - resistor / bulb        : g = 1/R,      J = 0
 *  - switch                 : g = closed ? 1e3 : 1e-9
 *  - led (a = anode)        : on  -> g = 1/Rs, J = Vf/Rs ; off -> g = 1e-9
 *
 * Element shape: { id, type, value, nodes: [a, b], closed?, flipped? }
 * Returns { nodeVoltages, elements: { [id]: { current, voltage, power, state } },
 *           totalCurrent, status, warnings }
 */

export const BATTERY_R_INT = 0.01; // ohms
const LED_VF = 2.0;
const LED_RS = 25;
const G_OPEN = 1e-9;
const G_CLOSED = 1e3;
const G_LEAK = 1e-9; // tiny leak to ground so floating nets stay solvable

function stampFor(el, ledOn) {
  switch (el.type) {
    case 'battery': {
      const V = Number(el.value) || 0;
      return { g: 1 / BATTERY_R_INT, J: V / BATTERY_R_INT };
    }
    case 'resistor':
    case 'bulb': {
      const R = Math.max(Number(el.value) || 0, 1e-3);
      return { g: 1 / R, J: 0 };
    }
    case 'switch':
      return { g: el.closed === false ? G_OPEN : G_CLOSED, J: 0 };
    case 'led':
      return ledOn ? { g: 1 / LED_RS, J: LED_VF / LED_RS } : { g: G_OPEN, J: 0 };
    default:
      return { g: G_CLOSED, J: 0 }; // plain wire
  }
}

/** Gaussian elimination with partial pivoting. Mutates A, b. */
function solveLinear(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-18) continue;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = Math.abs(A[r][r]) < 1e-18 ? 0 : s / A[r][r];
  }
  return x;
}

/** Orient nodes so that a = + / anode, honoring the user "flipped" flag. */
function orientedNodes(el) {
  const [a, b] = el.nodes;
  return el.flipped ? [b, a] : [a, b];
}

export function solveCircuit(elements, nodeCount) {
  const warnings = [];
  if (!elements.length || nodeCount < 2) {
    return { nodeVoltages: [], elements: {}, totalCurrent: 0, status: 'empty', warnings };
  }
  const batteries = elements.filter((e) => e.type === 'battery');
  if (!batteries.length) warnings.push('No power source detected');

  // Ground = negative terminal of first battery (or node 0).
  const ground = batteries.length ? orientedNodes(batteries[0])[1] : 0;
  const idx = (n) => (n === ground ? -1 : n < ground ? n : n - 1);
  const N = nodeCount - 1;

  const leds = elements.filter((e) => e.type === 'led');
  const ledOn = Object.fromEntries(leds.map((e) => [e.id, true]));

  let V = new Array(nodeCount).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const A = Array.from({ length: N }, () => new Array(N).fill(0));
    const rhs = new Array(N).fill(0);
    for (let i = 0; i < N; i++) A[i][i] += G_LEAK;

    for (const el of elements) {
      const [na, nb] = orientedNodes(el);
      const { g, J } = stampFor(el, ledOn[el.id]);
      const ia = idx(na);
      const ib = idx(nb);
      if (ia >= 0) { A[ia][ia] += g; rhs[ia] += J; }
      if (ib >= 0) { A[ib][ib] += g; rhs[ib] -= J; }
      if (ia >= 0 && ib >= 0) { A[ia][ib] -= g; A[ib][ia] -= g; }
    }

    const x = solveLinear(A, rhs);
    V = new Array(nodeCount).fill(0);
    for (let n = 0; n < nodeCount; n++) V[n] = n === ground ? 0 : x[idx(n)];

    // Re-evaluate LED states; stop when stable.
    let changed = false;
    for (const el of leds) {
      const [na, nb] = orientedNodes(el);
      const on = V[na] - V[nb] > LED_VF;
      if (on !== ledOn[el.id]) { ledOn[el.id] = on; changed = true; }
    }
    if (!changed) break;
  }

  const out = {};
  let totalCurrent = 0;
  for (const el of elements) {
    const [na, nb] = orientedNodes(el);
    const { g, J } = stampFor(el, ledOn[el.id]);
    let current = (V[na] - V[nb]) * g - J; // a -> b through element (oriented)
    if (Math.abs(current) < 1e-7) current = 0;
    const voltage = V[na] - V[nb];
    const power = Math.abs(el.type === 'battery' ? (Number(el.value) || 0) * current : voltage * current);
    let state = 'ok';
    if (el.type === 'led') {
      state = ledOn[el.id] ? 'on' : 'off';
      if (Math.abs(current) > 0.03) { state = 'burnt'; warnings.push(`${el.label || 'LED'} over 30mA - add a resistor!`); }
    }
    if (el.type === 'battery') {
      totalCurrent += -current; // delivered current flows b -> a internally
      if (Math.abs(current) > (Number(el.value) || 0) / (BATTERY_R_INT * 4)) {
        state = 'short';
        warnings.push('SHORT CIRCUIT across the battery!');
      }
    }
    // Report current in terms of the element's ORIGINAL node order (for flow drawing).
    out[el.id] = { current: el.flipped ? -current : current, voltage, power, state };
  }

  let status = 'closed';
  if (!batteries.length) status = 'no-source';
  else if (Math.abs(totalCurrent) < 1e-6) status = 'open';
  if (warnings.some((w) => w.startsWith('SHORT'))) status = 'short';

  return { nodeVoltages: V, elements: out, totalCurrent, status, warnings: [...new Set(warnings)] };
}
