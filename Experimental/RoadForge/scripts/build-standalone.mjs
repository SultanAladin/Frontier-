import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const Directory = resolve(import.meta.dirname, '..');
const BuildDirectory = resolve(Directory, 'dist-standalone');
const HtmlPath = resolve(BuildDirectory, 'index.html');
const OutputPath = resolve(Directory, 'RoadForge.html');
let Html = await readFile(HtmlPath, 'utf8');

const ScriptTag = Html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/i);
if (!ScriptTag) throw new Error('Vite output did not contain a script bundle to inline.');
const ScriptAsset = resolve(BuildDirectory, ScriptTag[1].replace(/^\.\//, ''));
const Script = (await readFile(ScriptAsset, 'utf8')).replace(/<\/script/gi, '<\\/script');
Html = Html.replace(ScriptTag[0], () => `<script type="module">${Script}</script>`);

const StyleTag = Html.match(/<link\b(?=[^>]*\brel="stylesheet")(?=[^>]*\bhref="([^"]+)")[^>]*>/i);
if (StyleTag) {
  const StyleUrl = StyleTag[0].match(/\bhref="([^"]+)"/i)?.[1];
  const StyleAsset = resolve(BuildDirectory, StyleUrl.replace(/^\.\//, ''));
  const Style = (await readFile(StyleAsset, 'utf8')).replace(/<\/style/gi, '<\\/style');
  Html = Html.replace(StyleTag[0], () => `<style>${Style}</style>`);
}

Html = Html.replace(/<link\b(?=[^>]*\brel="modulepreload")[^>]*>\s*/gi, '');
const HtmlOutsideBundle = Html.replace(/<script type="module">[\s\S]*?<\/script>/i, '<script type="module">INLINE_BUNDLE</script>');
if (/<(?:script|link)\b[^>]*(?:src|href)="(?:\.\/)?assets\//i.test(HtmlOutsideBundle)) {
  throw new Error('Standalone output still references external build assets.');
}
if (/\b(?:from|import\()\s*["']\.\/?assets\//.test(Script)) {
  throw new Error('Standalone JavaScript still imports an external build chunk.');
}

await writeFile(OutputPath, Html, 'utf8');
console.log(`Standalone RoadForge page written to ${OutputPath} (${(Buffer.byteLength(Html) / 1024 / 1024).toFixed(2)} MiB).`);
