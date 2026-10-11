// Minimal 2D-canvas stub so the procedural texture painters can run in node.

export function installCanvasStub() {
  const context = () => {
    const noop = () => {};
    return {
      canvas: null,
      fillStyle: '#000',
      strokeStyle: '#000',
      lineWidth: 1,
      font: '',
      textAlign: 'left',
      textBaseline: 'alphabetic',
      globalAlpha: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: noop,
      drawImage: noop,
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      arc: noop,
      ellipse: noop,
      rect: noop,
      fill: noop,
      stroke: noop,
      save: noop,
      restore: noop,
      translate: noop,
      rotate: noop,
      scale: noop,
      setTransform: noop,
      setLineDash: noop,
      fillText: noop,
      strokeText: noop,
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createLinearGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      clip: noop,
      quadraticCurveTo: noop,
      bezierCurveTo: noop,
    };
  };

  const makeCanvas = () => {
    const canvas = {
      width: 1,
      height: 1,
      style: {},
      getContext: () => context(),
      toDataURL: () => 'data:,',
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return canvas;
  };

  globalThis.document = {
    createElement: (tag) => (tag === 'canvas' ? makeCanvas() : { style: {}, appendChild: () => {}, addEventListener: () => {} }),
    createElementNS: () => makeCanvas(),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.window = globalThis.window || {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  globalThis.self = globalThis.self || globalThis;
}
