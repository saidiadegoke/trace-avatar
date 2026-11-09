// Bundle the framework fixtures the browser tests need (React, from node_modules).
import { build } from 'esbuild';

for (const name of ['react-form', 'react-example']) await build({
  entryPoints: [`tests/e2e/fixtures/${name}.tsx`],
  outfile: `tests/e2e/fixtures/${name}.js`,
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'warning',
});
console.log('fixtures built');
