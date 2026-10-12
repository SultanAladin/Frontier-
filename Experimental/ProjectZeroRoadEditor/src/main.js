// Entry point: wires the RoadEditor, the DOM UI and project persistence together.

import { RoadEditor } from './editor/editor.js';
import { mountUI } from './editor/ui.js';
import { saveLocal, loadLocal, exportProjectJSON, exportGLB, readProjectFile } from './editor/storage.js';
import { generateCity, CITY_DEFAULTS } from './core/city.js';
import { createProject } from './core/model.js';

const canvas = document.getElementById('scene');
let ui = null;
let saveTimer = null;
let pendingSave = false;

const editor = new RoadEditor({
  canvas,
  onChange: (state) => ui?.update(state),
  onMessage: (text) => ui?.message(text),
});

/** Debounced autosave: writes at most once every 600 ms after the last edit. */
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!pendingSave) return;
  pendingSave = false;
  saveLocal(editor.project);
}
editor.scheduleSave = () => {
  pendingSave = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
};
window.addEventListener('pagehide', flushSave);

ui = mountUI(editor, {
  onOpen: async (file) => {
    try {
      const project = await readProjectFile(file);
      editor.replaceProject(project, `Open ${file.name}`);
      editor.onMessage(`Opened ${file.name}.`);
    } catch (err) {
      console.error(err);
      editor.onMessage(`Could not open ${file.name}: the file is not a valid road project.`);
    }
  },
  onExportJSON: () => {
    exportProjectJSON(editor.project);
    editor.onMessage('Saved project JSON.');
  },
  onExportGLB: async () => {
    editor.onMessage('Exporting glTF… this can take a few seconds for large maps.');
    try {
      await exportGLB(editor);
      editor.onMessage('Exported .glb.');
    } catch (err) {
      console.error(err);
      editor.onMessage('Export failed. See the console for details.');
    }
  },
  onNewEmpty: () => {
    if (editor.project.roads.length && !window.confirm('Start an empty map? Ctrl+Z restores the current one.')) return;
    editor.replaceProject(createProject('Untitled city'), 'New empty map');
  },
});

// Ctrl+S saves the JSON file (the browser's default save dialog is suppressed).
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyS') {
    e.preventDefault();
    exportProjectJSON(editor.project);
  }
});

// Restore the last session, or generate a default city on first run.
const saved = loadLocal();
if (saved && saved.roads.length) {
  editor.loadProject(saved, { resetHistory: true });
  editor.onMessage('Restored your last session. Use Generate city for a fresh map.');
} else {
  editor.loadProject(generateCity(CITY_DEFAULTS), { resetHistory: true });
  editor.onMessage('Generated the default city. Hold right mouse and use WASD to fly.');
}

// Debugging and automated checks: `window.pzRoad.stats()`, `window.pzRoad.generate({seed: 3})`, etc.
window.pzRoad = editor;
