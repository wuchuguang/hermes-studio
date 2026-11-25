
const ts = require("typescript");
const fs = require("fs");
const src = fs.readFileSync("packages/client/src/components/hermes/chat/ChatPanel.vue", "utf8");
const s = src.indexOf("<script setup");
const e = src.indexOf("</script>");
const code = src.slice(s + 14, e);
const sf = ts.createSourceFile("cp.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let topFn = 0, allFn = 0, giant = 0;
sf.statements.forEach(st => {
  const a = sf.getLineAndCharacterOfPosition(st.getStart()).line, b = sf.getLineAndCharacterOfPosition(st.getEnd()).line;
  if (b - a > 800) giant++;
});
function walk(node){ if (ts.isFunctionDeclaration(node)) allFn++; ts.forEachChild(node, walk); }
walk(sf);
console.log("巨型语句:", giant, "| parseDiag:", sf.parseDiagnostics.length);
