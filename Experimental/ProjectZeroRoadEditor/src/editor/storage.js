// Persistence: autosave to localStorage, JSON open/save, and glTF (.glb) export.

import { deserialize, serialize } from '../core/model.js';

export const AUTOSAVE_KEY = 'pz-road-editor:project:v1';

export function saveLocal(project) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialize(project));
    return true;
  } catch (err) {
    console.warn('Autosave skipped:', err);
    return false;
  }
}

export function loadLocal() {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    return text ? deserialize(text) : null;
  } catch (err) {
    console.warn('Ignoring unreadable autosave:', err);
    return null;
  }
}

export function clearLocal() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeName(name) {
  return (name || 'road-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'road-project';
}

export function exportProjectJSON(project) {
  download(`${safeName(project.name)}.pzroad.json`, new Blob([serialize(project)], { type: 'application/json' }));
}

export function readProjectFile(file) {
  return file.text().then((text) => deserialize(text));
}

/**
 * Export every road tile as one binary glTF. Trench masks and ghost roofs are editor
 * helpers, not geometry, so they are hidden for the export. Ground and grid live in
 * the stage, not the road world, and are never included.
 */
export async function exportGLB(editor) {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  editor.world.buildAll();
  const hidden = [];
  editor.world.root.traverse((obj) => {
    if (obj.isMesh && (obj.name.endsWith(':mask') || obj.name.endsWith(':ghost')) && obj.visible) {
      hidden.push(obj);
      obj.visible = false;
    }
  });
  try {
    const glb = await new Promise((resolve, reject) => {
      new GLTFExporter().parse(editor.world.root, resolve, reject, { binary: true, onlyVisible: true });
    });
    download(`${safeName(editor.project.name)}.glb`, new Blob([glb], { type: 'model/gltf-binary' }));
  } finally {
    for (const obj of hidden) obj.visible = true;
  }
}
