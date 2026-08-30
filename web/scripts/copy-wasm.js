/* eslint-disable @typescript-eslint/no-require-imports */
// Copia sql-wasm.wasm da node_modules dentro public/sqljs/, cosi'
// il browser puo' scaricarlo come asset statico (vedi lib/db.ts -> locateFile).
const fs = require("fs");
const path = require("path");

const src = path.join(__dirname, "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
const destDir = path.join(__dirname, "..", "public", "sqljs");
const dest = path.join(destDir, "sql-wasm.wasm");

if (!fs.existsSync(src)) {
  console.warn("[copy-wasm] sql-wasm.wasm non trovato in node_modules, salto la copia.");
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log("[copy-wasm] sql-wasm.wasm copiato in public/sqljs/");
