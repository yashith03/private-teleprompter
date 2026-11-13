// Builds the app and packages it as a Windows x64 NSIS installer.
// Runs every tool through the current Node binary (process.execPath) and prepends its folder to PATH
// for child processes only, so it works even when npm/node are not on the Windows PATH
// (avoids the nested "npm run" lookup failure) and needs no permanent PATH change.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeDir = path.dirname(process.execPath);
const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false', PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}` };

function run(label, script, args = []) {
  const file = path.join(root, script);
  if (!fs.existsSync(file)) {
    console.error(`[package] missing ${script} - run "npm install" first.`);
    process.exit(1);
  }
  console.log(`\n[package] ${label}`);
  const r = spawnSync(process.execPath, [file, ...args], { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`[package] ${label} failed (exit ${r.status}).`);
    process.exit(r.status ?? 1);
  }
}

run('icon', 'scripts/make-icon.mjs');
run('renderer build', 'node_modules/vite/bin/vite.js', ['build']);
run('main/preload build', 'node_modules/typescript/bin/tsc', ['-p', 'tsconfig.main.json']);
run('installer', 'node_modules/electron-builder/cli.js', ['--win', 'nsis', '--x64', '--publish', 'never']);

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')).version;
console.log(`\n[package] done: ${path.join(root, 'release', `Private-Teleprompter-Setup-${version}.exe`)}`);
