import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src');
const distRoot = path.join(root, 'dist');
const files = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? files(full) : [full];
});
const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFiles = files(sourceRoot).filter((file) => file.endsWith('.ts'));
const marker = path.join(distRoot, '.source-hash');
const combinedHash = createHash('sha256').update(sourceFiles.map((file) => `${path.relative(sourceRoot, file)}:${digest(file)}`).sort().join('\n')).digest('hex');
const expectedBuildFiles = new Set(sourceFiles.map((file) => path.resolve(distRoot, path.relative(sourceRoot, file).replace(/\.ts$/, '.js'))));
const actualBuildFiles = fs.existsSync(distRoot) ? files(distRoot).filter((file) => file.endsWith('.js')).map((file) => path.resolve(file)) : [];
const missingBuildFiles = [...expectedBuildFiles].filter((file) => !fs.existsSync(file));
const extraBuildFiles = actualBuildFiles.filter((file) => !expectedBuildFiles.has(file));
if (process.argv.includes('--write')) {
  if (missingBuildFiles.length || extraBuildFiles.length) {
    console.error(`Arquivos compilados divergentes: ${[...missingBuildFiles, ...extraBuildFiles].map((file) => path.relative(root, file)).join(', ')}`);
    process.exit(1);
  }
  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(marker, `${combinedHash}\n`);
  process.exit(0);
}
if (missingBuildFiles.length || extraBuildFiles.length) {
  console.error(`Arquivos compilados divergentes: ${[...missingBuildFiles, ...extraBuildFiles].map((file) => path.relative(root, file)).join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== combinedHash) {
  console.error('dist está desatualizado em relação a src; rode npm run build.');
  process.exit(1);
}
