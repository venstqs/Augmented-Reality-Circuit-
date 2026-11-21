/**
 * Global environment polyfills for React Native & Hermes.
 * Must be imported at the very top of index.js before any other module loads.
 */

// 1. Polyfill process.emitWarning (called by Three.js CommonJS entry in node_modules/three)
if (typeof process !== 'undefined') {
  if (typeof process.emitWarning !== 'function') {
    process.emitWarning = function () {};
  }
}

// 2. Ensure performance API methods are safely callable
if (typeof globalThis.performance === 'undefined') {
  globalThis.performance = {
    now: () => Date.now(),
    timeOrigin: Date.now(),
    mark: () => {},
    measure: () => {},
    clearMarks: () => {},
    clearMeasures: () => {},
    getEntries: () => [],
    getEntriesByName: () => [],
    getEntriesByType: () => [],
  };
} else {
  if (typeof globalThis.performance.clearMarks !== 'function') {
    globalThis.performance.clearMarks = function () {};
  }
  if (typeof globalThis.performance.clearMeasures !== 'function') {
    globalThis.performance.clearMeasures = function () {};
  }
}

