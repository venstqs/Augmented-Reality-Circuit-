/**
 * Built-in demo circuits so the AR visualizer works before a model is trained.
 * Boxes are normalized (0..1) relative to the screen in demo mode.
 * nodes = [net of terminal 0, net of terminal 1]; terminal 0 = top / left.
 */
import { terminalsFromBox } from './topology.js';

function make(id, type, label, value, box, nodes, extra = {}) {
  return { id, type, label, value, box, nodes, closed: true, flipped: false, ...terminalsFromBox(box), ...extra };
}

export const DEMOS = [
  {
    key: 'parallel',
    title: 'Parallel bulbs (9V · 6Ω · 12Ω)',
    nodeCount: 2,
    components: [
      make('B1', 'battery', 'V', 9, { x: 0.08, y: 0.4, w: 0.14, h: 0.2 }, [0, 1]),
      make('R1', 'bulb', 'R1', 6, { x: 0.43, y: 0.4, w: 0.14, h: 0.2 }, [0, 1]),
      make('R2', 'bulb', 'R2', 12, { x: 0.76, y: 0.4, w: 0.14, h: 0.2 }, [0, 1]),
    ],
  },
  {
    key: 'series-led',
    title: 'LED + switch + 330Ω',
    nodeCount: 4,
    components: [
      make('B1', 'battery', 'V', 9, { x: 0.08, y: 0.42, w: 0.14, h: 0.18 }, [0, 3]),
      make('S1', 'switch', 'S1', 0, { x: 0.38, y: 0.27, w: 0.24, h: 0.07 }, [0, 1]),
      make('R1', 'resistor', 'R1', 330, { x: 0.78, y: 0.42, w: 0.12, h: 0.18 }, [1, 2]),
      // Anode is on the right (towards the resistor) -> flipped.
      make('D1', 'led', 'LED', 0, { x: 0.4, y: 0.66, w: 0.2, h: 0.08 }, [3, 2], { flipped: true }),
    ],
  },
  {
    key: 'series-bulbs',
    title: 'Series bulbs (9V · 6Ω + 12Ω)',
    nodeCount: 3,
    components: [
      make('B1', 'battery', 'V', 9, { x: 0.08, y: 0.42, w: 0.14, h: 0.18 }, [0, 2]),
      make('R1', 'bulb', 'R1', 6, { x: 0.38, y: 0.26, w: 0.24, h: 0.09 }, [0, 1]),
      make('R2', 'bulb', 'R2', 12, { x: 0.78, y: 0.42, w: 0.12, h: 0.18 }, [1, 2]),
    ],
  },
  {
    key: 'mixed-switch',
    title: 'Series + parallel (12V)',
    nodeCount: 4,
    components: [
      make('B1', 'battery', 'B1', 12, { x: 0.08, y: 0.44, w: 0.14, h: 0.20 }, [0, 3]),
      make('S1', 'switch', 'S1', 0, { x: 0.22, y: 0.22, w: 0.18, h: 0.07 }, [0, 1]),
      make('R1', 'resistor', 'R1', 4, { x: 0.58, y: 0.22, w: 0.20, h: 0.08 }, [1, 2]),
      make('L1', 'bulb', 'L1', 12, { x: 0.46, y: 0.44, w: 0.14, h: 0.20 }, [2, 3]),
      make('L2', 'bulb', 'L2', 12, { x: 0.78, y: 0.44, w: 0.14, h: 0.20 }, [2, 3]),
    ],
  },
];
