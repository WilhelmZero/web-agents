import { build } from 'esbuild';

await Promise.all([
  build({ entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron', 'better-sqlite3', 'sharp'] }),
  build({ entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: true, external: ['electron'] }),
]);
