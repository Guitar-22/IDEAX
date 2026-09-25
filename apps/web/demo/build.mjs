// Bundles the in-browser demo into dist/: index.html (inline JS + CSS) + PGlite binaries.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const out = path.join(here, 'dist');
const pgDist = path.resolve(web, '../../node_modules/@electric-sql/pglite/dist');

const redirect = {
  name: 'demo-redirects',
  setup(b) {
    const map = {
      fastify: 'shims/fastify.ts',
      '@fastify/cors': 'shims/cors.ts',
      'node:crypto': 'shims/node-crypto.ts',
      'next/link': 'router/next-link.tsx',
      'next/navigation': 'router/next-navigation.ts',
    };
    b.onResolve({ filter: /^(fastify|@fastify\/cors|node:crypto|next\/link|next\/navigation)$/ }, (a) => ({ path: path.join(here, map[a.path]) }));
    b.onResolve({ filter: /core\/auth\.js$/ }, () => ({ path: path.join(here, 'shims/auth.ts') }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve('./' + a.path.slice(2), { resolveDir: path.join(web, 'src'), kind: a.kind }));
    // apps/api uses NodeNext-style ".js" specifiers for .ts files
    b.onResolve({ filter: /^\.\.?\/.*\.js$/ }, async (a) => {
      if (a.pluginData === 'skip') return;
      const r = await b.resolve(a.path.replace(/\.js$/, '.ts'), { resolveDir: a.resolveDir, kind: a.kind, pluginData: 'skip' });
      return r.errors.length ? undefined : { path: r.path };
    });
  },
};

await mkdir(out, { recursive: true });
const res = await build({
  entryPoints: [path.join(here, 'main.tsx')],
  bundle: true,
  write: false,
  outdir: out,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  loader: { '.sql': 'text' },
  define: {
    'process.env.NEXT_PUBLIC_API_URL': '"local"',
    'process.env.NODE_ENV': '"production"',
    'process.env.AUTH_SECRET': 'undefined',
  },
  banner: { js: 'globalThis.process ??= { env: {} };' },
  plugins: [redirect],
  logLevel: 'warning',
});
const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const html = `<title>IDEAX × THAItern</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
await writeFile(path.join(out, 'index.html'), html);
for (const [f, to] of [['pglite.wasm', 'pglite.wasm'], ['initdb.wasm', 'initdb.wasm'], ['pglite.data', 'pglite-data.wasm']]) await copyFile(path.join(pgDist, f), path.join(out, to));
console.log('index.html', (html.length / 1024).toFixed(0), 'KB');
