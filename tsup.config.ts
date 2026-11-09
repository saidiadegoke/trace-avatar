import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', react: 'src/react/index.tsx', element: 'src/element/index.ts', record: 'src/record/index.ts', perform: 'src/perform/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['react'],
    target: 'es2021',
  },
  {
    entry: { trace: 'src/index.ts' },
    format: ['iife'],
    globalName: 'TraceAvatar',
    minify: true,
    sourcemap: true,
    target: 'es2021',
    outExtension: () => ({ js: '.min.js' }),
  },
  {
    entry: { 'trace-perform': 'src/perform/index.ts' },
    format: ['iife'],
    globalName: 'TraceAvatar',
    minify: true,
    sourcemap: true,
    target: 'es2021',
    outExtension: () => ({ js: '.min.js' }),
  },
  {
    entry: { 'trace-record': 'src/record/index.ts' },
    format: ['iife'],
    globalName: 'TraceAvatarRecord',
    minify: true,
    sourcemap: true,
    target: 'es2021',
    outExtension: () => ({ js: '.min.js' }),
  },
]);
