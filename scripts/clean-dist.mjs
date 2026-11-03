import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = path.join(root, 'dist');
const target = path.resolve(expected);
if (target !== expected || !target.startsWith(`${root}${path.sep}`)) throw new Error('Caminho dist inesperado; compilação cancelada.');
fs.rmSync(target, { recursive: true, force: true });
