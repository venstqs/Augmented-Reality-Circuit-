import { solveCircuit } from '../src/circuit/solver.js';
import { buildWireSegments } from '../src/circuit/topology.js';
import { DEMOS } from '../src/circuit/demo.js';

for (const d of DEMOS) {
  const els = d.components.map((c) => ({ ...c }));
  const s = solveCircuit(els, d.nodeCount);
  console.log('\n==', d.title, '| status:', s.status, '| total I:', s.totalCurrent.toFixed(4), s.warnings);
  for (const [id, r] of Object.entries(s.elements))
    console.log(' ', id, 'I=', r.current.toFixed(4), 'V=', r.voltage.toFixed(3), 'P=', r.power.toFixed(3), r.state);
  console.log('  wires:', buildWireSegments(d.components, s).map((w) => w.flow.toFixed(3)).join(', '));
}
// Open switch test
const d = DEMOS[1];
const els = d.components.map((c) => ({ ...c, closed: c.type === 'switch' ? false : true }));
console.log('\nopen switch status:', solveCircuit(els, d.nodeCount).status);
