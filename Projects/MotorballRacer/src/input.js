// Minimal keyboard input state, WASD + arrow keys + handbrake/camera/reset.
export function createInput() {
  const state = {
    forward: false,
    back: false,
    left: false,
    right: false,
    handbrake: false,
    _cameraToggle: false,
    _reset: false,
  };

  const down = new Set();

  function set(code, value) {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        state.forward = value;
        break;
      case "KeyS":
      case "ArrowDown":
        state.back = value;
        break;
      case "KeyA":
      case "ArrowLeft":
        state.left = value;
        break;
      case "KeyD":
      case "ArrowRight":
        state.right = value;
        break;
      case "Space":
        state.handbrake = value;
        break;
      case "KeyC":
        if (value && !down.has(code)) state._cameraToggle = true;
        break;
      case "KeyR":
        if (value && !down.has(code)) state._reset = true;
        break;
      default:
        break;
    }
    if (value) down.add(code);
    else down.delete(code);
  }

  window.addEventListener("keydown", (e) => {
    set(e.code, true);
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => set(e.code, false));
  window.addEventListener("blur", () => {
    state.forward = state.back = state.left = state.right = state.handbrake = false;
    down.clear();
  });

  return {
    state,
    consumeCameraToggle() {
      const v = state._cameraToggle;
      state._cameraToggle = false;
      return v;
    },
    consumeReset() {
      const v = state._reset;
      state._reset = false;
      return v;
    },
  };
}
