/**
 * Maps the trained model's class names to the app's component types.
 * Works with CGHD-style names ("resistor", "voltage.dc", "lamp",
 * "diode.light_emitting", "switch", "text", ...) and simple custom names.
 * Returns: 'battery' | 'resistor' | 'bulb' | 'led' | 'switch' | 'text' | null
 */
export function mapClass(name) {
  const n = String(name).toLowerCase();
  if (n.includes('light_emitting') || n === 'led') return 'led';
  if (n.includes('battery') || n.startsWith('voltage') || n.includes('cell') || n.includes('source')) return 'battery';
  if (n.includes('lamp') || n.includes('bulb')) return 'bulb';
  if (n.includes('resistor')) return 'resistor';
  if (n.includes('switch')) return 'switch';
  if (n === 'text' || n.includes('label')) return 'text';
  return null; // junctions, terminals, crossovers, unsupported parts -> treated as wire/ignored
}
