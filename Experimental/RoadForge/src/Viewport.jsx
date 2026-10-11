import React, { useEffect, useRef } from 'react';
import { RoadForgeViewport } from './scene.js';

export default function Viewport({ project, selected, tool, draftPoints, layers, settings, onSelect, onRoadPoint, onNodeMove, onRendererState, onViewportReady }) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const callbacksRef = useRef({ onSelect, onRoadPoint, onNodeMove, onRendererState });
  const latestRef = useRef({ project, selected, tool, draftPoints, layers, settings });
  callbacksRef.current = { onSelect, onRoadPoint, onNodeMove, onRendererState };
  latestRef.current = { project, selected, tool, draftPoints, layers, settings };

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const Engine = new RoadForgeViewport(canvasRef.current, {
      onSelect: (Value) => callbacksRef.current.onSelect?.(Value),
      onRoadPoint: (Value) => callbacksRef.current.onRoadPoint?.(Value),
      onNodeMove: (Id, Value) => callbacksRef.current.onNodeMove?.(Id, Value),
      onRendererState: (Value) => callbacksRef.current.onRendererState?.(Value),
    });
    engineRef.current = Engine;
    Engine.initialize().then(() => {
      if (Engine.disposed) return;
      const Latest = latestRef.current;
      Engine.update(Latest.project, Latest);
      onViewportReady?.(Engine);
    }).catch((Error) => {
      callbacksRef.current.onRendererState?.(`Renderer error · ${Error.message}`);
    });
    return () => {
      Engine.dispose();
      engineRef.current = null;
      onViewportReady?.(null);
    };
    // This effect owns the renderer lifecycle. Scene state is synchronized below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engineRef.current?.update(project, { selected, tool, draftPoints, layers, settings });
  }, [project, selected, tool, draftPoints, layers, settings]);

  return <canvas ref={canvasRef} className="viewport-canvas" aria-label="Interactive WebGPU road design viewport" />;
}
