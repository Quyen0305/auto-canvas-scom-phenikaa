// Copy upstream functionality verbatim inside an integration wrapper.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const source = process.argv[2] || 'D:/canvas extension';
const target = path.resolve(__dirname, '../extension/canvas');
fs.mkdirSync(target, {recursive:true});
const hashes = {};
const normalizedHashes = {};
for (const file of ['background.js','content.js','quiz-learning.js','chrome-ai.js','styles.css']) {
  const bytes = fs.readFileSync(path.join(source,file));
  hashes[file] = crypto.createHash('sha256').update(bytes).digest('hex');
  normalizedHashes[file] = crypto.createHash('sha256').update(bytes.toString('utf8').replace(/\r\n?/g,'\n')).digest('hex');
  // The merged product owns its compact settings markup; never replace it with upstream UI.
  if (file === 'popup.html' && fs.existsSync(path.join(target,file))) continue;
  let text = bytes.toString('utf8');
  if (['content.js','popup.js','quiz-learning.js'].includes(file)) {
    text = `(function(chrome) {\n${text}\n})(CanvasCompat.create(${file === 'content.js'}));\n`;
  }
  if (file === 'background.js') text = `(function(chrome, importScripts, ChromeAi) {\n${text}\n})(CanvasCompat.create(false), () => {}, SuiteCanvasAI);\n`;
  if (file === 'content.js') text += '\nCanvasCompat.compactWidget();\n';
  if (file === 'popup.html') text = text.replace('<script src="chrome-ai.js">', '<script src="../canvas-compat.js"></script>\n  <script src="chrome-ai.js">')
    .replace('</head>', '<link rel="stylesheet" href="../suite-panel.css">\n</head>');
  fs.writeFileSync(path.join(target,file),text);
}
fs.writeFileSync(path.join(target,'upstream-hashes.json'),JSON.stringify({source:'Canvas extension, original functionality preserved inside wrappers',sha256:hashes,normalizedSha256:normalizedHashes},null,2)+'\n');
console.log('Canvas integration copied; upstream files were not modified.');
