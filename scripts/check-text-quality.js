const fs = require("fs");
const path = require("path");

const ROOTS = ["src", "docs", "supabase"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".md", ".sql", ".json"]);
const FORBIDDEN = [
  "RegulaÃ",
  "DeliberaÃ",
  "AgÃ",
  "Observatorio da Regulacao",
  "Relatorios do Observatorio",
];

const failures = [];

for (const root of ROOTS) {
  const absolute = path.join(process.cwd(), root);
  if (fs.existsSync(absolute)) walk(absolute);
}

if (failures.length > 0) {
  console.error("Foram encontrados textos com possível mojibake/acentuação ausente:");
  for (const failure of failures.slice(0, 80)) {
    console.error(`- ${failure.file}: ${failure.pattern}`);
  }
  if (failures.length > 80) console.error(`... e mais ${failures.length - 80} ocorrência(s).`);
  process.exit(1);
}

console.log("Textos verificados sem padrões comuns de mojibake.");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!["node_modules", ".next", ".git"].includes(entry.name)) walk(file);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(file))) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN) {
      if (text.includes(pattern)) failures.push({ file: path.relative(process.cwd(), file), pattern });
    }
  }
}
