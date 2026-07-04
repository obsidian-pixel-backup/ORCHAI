// Launches Electron with a clean environment.
//
// Some Windows setups export ELECTRON_RUN_AS_NODE=1 globally (it can be left
// behind by other Electron tooling). When set, the Electron binary runs as plain
// Node instead of as an app: require('electron') returns a path string, so `app`
// is undefined and startup crashes with
//   "Cannot read properties of undefined (reading 'whenReady')".
// We strip the variable here so `npm run electron:dev` always launches the real
// app, regardless of the machine's ambient environment.
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// `electronPath` is the path to the Electron executable (that's what the electron
// npm package exports when imported from Node). Spawn it with the cleaned env.
const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

child.on('close', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('Failed to launch Electron:', err);
  process.exit(1);
});
