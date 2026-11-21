const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.cjs');
if (fs.existsSync(target)) {
  let content = fs.readFileSync(target, 'utf8');
  if (content.includes('process.emitWarning(') && !content.includes('typeof process.emitWarning')) {
    content = content.replace(
      /process\.emitWarning\([\s\S]*?\);/,
      'if (typeof process !== "undefined" && typeof process.emitWarning === "function") {\n  process.emitWarning(\'require("three") is deprecated\', { type: "DeprecationWarning" });\n}'
    );
    fs.writeFileSync(target, content, 'utf8');
    console.log('[patch-three] Patched three.cjs for React Native compatibility.');
  }
}

