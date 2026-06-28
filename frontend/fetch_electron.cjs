const { downloadArtifact } = require('@electron/get');
const extract = require('extract-zip');
const fs = require('fs');
const path = require('path');

async function download() {
  try {
    console.log('Downloading Electron binary...');
    const zipPath = await downloadArtifact({
      version: '42.2.0',
      artifactName: 'electron',
      platform: 'win32',
      arch: 'x64'
    });
    
    console.log('Extracting to dist...');
    const distPath = path.join(__dirname, 'node_modules/electron/dist');
    fs.mkdirSync(distPath, { recursive: true });
    await extract(zipPath, { dir: distPath });
    
    console.log('Writing path.txt...');
    fs.writeFileSync(path.join(__dirname, 'node_modules/electron/path.txt'), 'dist/electron.exe');
    console.log('SUCCESS: Electron binary downloaded and extracted manually.');
  } catch (err) {
    console.error('ERROR downloading electron:', err.message, err.stack);
  }
}

download();
