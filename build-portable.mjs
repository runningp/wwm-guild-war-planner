import { readFile, writeFile, mkdir } from 'node:fs/promises';
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const [html, css, core, app, icon] = await Promise.all(['index.html', 'styles.css', 'core.mjs', 'app.mjs', 'favicon.svg'].map(read));
const script = core.replace(/^export /gm, '') + '\n' + app.replace(/^import .* from '\.\/core\.mjs';\r?\n/, '');
const output = html
  .replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="./app.mjs"></script>', () => `<script type="module">\n${script.replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .replace('href="./favicon.svg"', `href="data:image/svg+xml,${encodeURIComponent(icon)}"`)
  .replace('class="brand" href="./"', 'class="brand" href="#main"');
await mkdir(new URL('./dist/', import.meta.url), { recursive: true });
await writeFile(new URL('./dist/index.html', import.meta.url), output, 'utf8');
await writeFile(new URL('./dist/.nojekyll', import.meta.url), '', 'utf8');
console.log('Portable static page ready: dist/index.html');
