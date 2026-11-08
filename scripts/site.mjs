// Assemble the static site for GitHub Pages in _site/: the playground, the vanilla example and the built library.
// Keeps the repo's relative paths (../dist, ../../dist), so the pages work unchanged.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

if (!existsSync('dist/trace.min.js')) {
  console.error('dist/ is missing: run `npm run build` first.');
  process.exit(1);
}
rmSync('_site', { recursive: true, force: true });
mkdirSync('_site/examples', { recursive: true });
cpSync('dist', '_site/dist', { recursive: true });
cpSync('playground', '_site/playground', { recursive: true });
cpSync('examples/vanilla-html', '_site/examples/vanilla-html', { recursive: true });
cpSync('schema', '_site/schema', { recursive: true });
writeFileSync('_site/index.html', `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>trace-avatar</title>
<meta http-equiv="refresh" content="0; url=playground/">
<link rel="canonical" href="playground/"></head>
<body><p><a href="playground/">trace-avatar playground</a> · <a href="examples/vanilla-html/">example</a> ·
<a href="https://github.com/saidiadegoke/trace-avatar">GitHub</a></p></body></html>
`);
writeFileSync('_site/.nojekyll', '');
console.log('site assembled in _site/');
