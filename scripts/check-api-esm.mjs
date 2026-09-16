import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const roots = ['api', 'server'];
const sourceExtensions = new Set(['.ts', '.js', '.mjs', '.cjs']);
const validRuntimeExtensions = /\.(?:js|mjs|cjs|json|node)$/i;
const problems = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const filePath = join(directory, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      walk(filePath);
      continue;
    }
    if (!sourceExtensions.has(extname(name))) continue;

    const source = readFileSync(filePath, 'utf8');
    const patterns = [
      /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g,
      /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
      /\brequire\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const specifier = match[1].split(/[?#]/, 1)[0];
        if (!validRuntimeExtensions.test(specifier)) {
          problems.push(`${filePath}: import ESM thiếu phần mở rộng runtime: ${match[1]}`);
        }
      }
    }
  }
}

for (const root of roots) walk(root);

if (problems.length) {
  console.error('Kiểm tra API ESM thất bại:\n' + problems.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('API/server ESM imports hợp lệ.');
