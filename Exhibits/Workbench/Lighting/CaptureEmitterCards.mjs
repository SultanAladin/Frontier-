// Captures the five scene-emitter inspectors from the running browser editor and
// asserts that every authored card, control and derived readout is actually present.
// Run the editor first:  npm --prefix Experimental/FrontierEditor run dev -- --port 5173
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The browser driver belongs to the browser editor, not to this proof, so resolve it from
// there rather than requiring a dependency beside the engine sources.
//   npm --prefix Experimental/FrontierEditor install --no-save puppeteer
const require = createRequire(import.meta.url);
const driverPaths = [process.env.FRONTIER_NODE_MODULES, path.resolve(here, '../../../Experimental/FrontierEditor/node_modules')].filter(Boolean);
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer', {paths: driverPaths})))).default;
const gallery = process.env.FRONTIER_GALLERY || path.resolve(here, '../../Gallery/Lighting');
const origin = process.env.FRONTIER_EDITOR_ORIGIN || 'http://127.0.0.1:5173/';
const executablePath = process.env.FRONTIER_CHROMIUM || '/tmp/chromium';

const emitters = [
  {name: 'Point Light',  file: 'PointLight',  cards: ['Luminous output', 'Colour temperature', 'Reach & falloff', 'Transform', 'Shadows & response', 'Luminous distribution', 'Renderer support']},
  {name: 'Spot Light',   file: 'SpotLight',   cards: ['Luminous output', 'Colour temperature', 'Beam shape', 'Reach & falloff', 'Transform', 'Shadows & response', 'Luminous distribution', 'Renderer support']},
  {name: 'Area Light',   file: 'AreaLight',   cards: ['Luminous output', 'Colour temperature', 'Emitter dimensions', 'Reach & falloff', 'Transform', 'Shadows & response', 'Renderer support']},
  {name: 'Tube Light',   file: 'TubeLight',   cards: ['Luminous output', 'Colour temperature', 'Emitter dimensions', 'Reach & falloff', 'Transform', 'Shadows & response', 'Renderer support']},
  {name: 'LED Strip',    file: 'StripLight',  cards: ['Luminous output', 'Colour temperature', 'Emitter dimensions', 'Reach & falloff', 'Transform', 'Shadows & response', 'Renderer support']},
];

let checks = 0;
const check = (condition, description) => { assert.ok(condition, description); checks += 1; };

fs.mkdirSync(gallery, {recursive: true});
const browser = await puppeteer.launch({
  executablePath, headless: 'shell',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--single-process', '--disable-gpu', '--font-render-hinting=none'],
});
const page = await browser.newPage();
// Two network dependencies are outside this proof and may legitimately be unreachable:
// the native Construct bridge on port 5191 (a separate native process) and the Google Fonts
// CDN (the page falls back to the local sans stack). Any other failed request, and every
// uncaught script error, fails this proof.
const permittedOrigin = url => /\/api\/construct/.test(url) || /fonts\.(googleapis|gstatic)\.com/.test(url);
const scriptErrors = [];
const blockedRequests = [];
page.on('pageerror', error => scriptErrors.push(String(error)));
page.on('requestfailed', request => { if (!permittedOrigin(request.url())) blockedRequests.push(request.url()); });
page.on('response', response => { const status = response.status(); if (status >= 400 && !permittedOrigin(response.url())) blockedRequests.push(`${status} ${response.url()}`); });

const select = async name => {
  const picked = await page.evaluate(objectName => {
    const button = [...document.querySelectorAll('.object-button')].find(node => node.textContent.trim().startsWith(objectName));
    if (!button) return false;
    button.click();
    return true;
  }, name);
  assert.ok(picked, `outliner row missing: ${name}`);
  await new Promise(resolve => setTimeout(resolve, 260));
};
const headings = () => page.$$eval('.card-heading > span:first-child', nodes => nodes.map(node => node.textContent.trim()));

for (const width of [1600, 1120]) {
  await page.setViewport({width, height: 1000, deviceScaleFactor: 1});
  await page.goto(origin, {waitUntil: 'networkidle0', timeout: 60000});
  await page.evaluate(() => localStorage.removeItem('frontier-project'));
  await page.reload({waitUntil: 'networkidle0'});

  for (const emitter of emitters) {
    await select(emitter.name);

    const title = await page.$eval('.object-header h1', node => node.textContent.trim());
    check(title === emitter.name, `${emitter.name}: inspector title is "${title}"`);

    const drawn = await headings();
    for (const card of emitter.cards) check(drawn.includes(card), `${emitter.name}: card "${card}" is drawn (got ${drawn.join(' | ')})`);
    check(!drawn.includes('Beam shape') || emitter.name === 'Spot Light', `${emitter.name}: beam card only on the spot`);
    check(!drawn.includes('Luminous distribution') || ['Point Light', 'Spot Light'].includes(emitter.name), `${emitter.name}: distribution only on punctual sources`);

    // The derived photometry must be present and finite, not placeholder text.
    const derived = await page.$$eval('.light-derived strong', nodes => nodes.map(node => node.textContent.trim()));
    check(derived.length >= 2, `${emitter.name}: derived intensity and illuminance are reported`);
    for (const value of derived) check(/[\d]/.test(value), `${emitter.name}: derived readout "${value}" carries a number`);

    // Honest support reporting rather than a silent claim of full renderer support.
    const support = await page.$$eval('.light-support-row', nodes => nodes.map(node => node.textContent.trim()));
    check(support.length === 3, `${emitter.name}: three renderer-support rows`);
    check(support.some(row => /No lightmap bake path/.test(row)), `${emitter.name}: bake limitation stated`);

    if (width === 1600) {
      const panel = await page.$('.inspector-content');
      await panel.screenshot({path: path.join(gallery, `${emitter.file}.png`)});
    } else {
      const panel = await page.$('.inspector-content');
      await panel.screenshot({path: path.join(gallery, `${emitter.file}-Narrow.png`)});
    }
  }
}

// The whole editor, so the new Lighting folder is visible in the hierarchy.
await page.setViewport({width: 1600, height: 1100, deviceScaleFactor: 1});
await page.goto(origin, {waitUntil: 'networkidle0'});
await select('Spot Light');
await page.screenshot({path: path.join(gallery, 'EditorWithLighting.png')});
const rows = await page.$$eval('.tree .object-button', nodes => nodes.map(node => node.textContent.trim()));
check(rows.some(row => row.startsWith('Lighting')), `Lighting folder present in the outliner (got ${rows.slice(0, 12).join(' | ')})`);
for (const emitter of emitters) check(rows.some(row => row.startsWith(emitter.name)), `${emitter.name} listed under the Lighting folder`);

await browser.close();
assert.deepEqual(scriptErrors, [], `uncaught script errors:\n${scriptErrors.join('\n')}`);
assert.deepEqual(blockedRequests, [], `unexpected failed requests:\n${blockedRequests.join('\n')}`);
console.log(`Scene-emitter capture: ${checks} checks passed, ${emitters.length * 2 + 1} images written to ${gallery}`);
