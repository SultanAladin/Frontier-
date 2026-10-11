import React from 'react';
import { getProfile } from '../engine/profiles.js';
import { CATEGORIES } from '../engine/profiles.js';

const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.accent]));

/**
 * Top-down network overview.  Drag to fly the camera; the wedge shows where the
 * viewport is looking.
 */
export default function Minimap({ network, viewport, bounds }) {
  const canvasRef = React.useRef(null);
  const size = 172;
  const [range, setRange] = React.useState({ cx: 0, cz: 0, span: 1000 });

  const computeRange = React.useCallback(() => {
    if (!network.nodes.size) return { cx: 0, cz: 0, span: 1200 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const node of network.nodes.values()) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minZ = Math.min(minZ, node.z);
      maxZ = Math.max(maxZ, node.z);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.06 + 80;
    return { cx, cz, span };
  }, [network]);

  React.useEffect(() => {
    setRange(computeRange());
  }, [computeRange, network.stats().roads, network.nodes.size]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#0b0e11';
      ctx.fillRect(0, 0, size, size);

      const scale = size / range.span;
      const project = (x, z) => [
        size / 2 + (x - range.cx) * scale,
        size / 2 + (z - range.cz) * scale,
      ];

      // water
      const river = network.settings.river;
      if (river) {
        ctx.strokeStyle = '#1c3a4a';
        ctx.lineWidth = Math.max(1.5, river.width * scale);
        ctx.beginPath();
        river.points.forEach((point, index) => {
          const [px, py] = project(point.x, point.z);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }

      // roads
      ctx.lineCap = 'round';
      for (const road of network.roads.values()) {
        if (road.visible === false) continue;
        const profile = getProfile(road.profileId);
        const points = road.nodeIds.map((id) => network.getNode(id)).filter(Boolean);
        if (points.length < 2) continue;
        ctx.strokeStyle = CATEGORY_COLORS[profile.category] || '#7c848c';
        ctx.lineWidth = profile.category === 'motorway' ? 2.2 : profile.category === 'transit' ? 1.6 : 1;
        ctx.globalAlpha = profile.category === 'active' || profile.category === 'residential' ? 0.55 : 0.85;
        ctx.beginPath();
        points.forEach((point, index) => {
          const [px, py] = project(point.x, point.z);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // subway
      for (const line of network.subways.values()) {
        const points = line.nodeIds.map((id) => network.getNode(id)).filter(Boolean);
        if (points.length < 2) continue;
        ctx.strokeStyle = `#${(line.color ?? 0x4f9ee8).toString(16).padStart(6, '0')}`;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        points.forEach((point, index) => {
          const [px, py] = project(point.x, point.z);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        for (const station of line.stations || []) {
          ctx.fillStyle = '#0b0e11';
          ctx.strokeStyle = `#${(line.color ?? 0x4f9ee8).toString(16).padStart(6, '0')}`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // camera wedge
      const camera = viewport?.cameraController;
      if (camera) {
        const [cx, cy] = project(camera.position.x, camera.position.z);
        const yaw = camera.yaw;
        ctx.fillStyle = 'rgba(99, 214, 255, 0.16)';
        ctx.strokeStyle = '#63d6ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const spread = 0.55;
        const reach = 26;
        ctx.lineTo(cx + Math.sin(yaw - spread) * reach, cy + Math.cos(yaw - spread) * reach);
        ctx.lineTo(cx + Math.sin(yaw + spread) * reach, cy + Math.cos(yaw + spread) * reach);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#63d6ff';
        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [network, range, viewport]);

  const onPointer = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || !viewport) return;
    if (event.buttons === 0 && event.type === 'pointermove') return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * range.span + range.cx;
    const z = ((event.clientY - rect.top) / rect.height - 0.5) * range.span + range.cz;
    const camera = viewport.cameraController;
    camera.position.x = x;
    camera.position.z = z;
    camera.position.y = Math.max(camera.position.y, viewport.world.terrain.heightAt(x, z) + 30);
    camera.applyToCamera();
  };

  return (
    <div className="minimap" onPointerDown={onPointer} onPointerMove={onPointer} title="Drag to fly">
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
      <div className="minimap-label">Overview · drag to fly</div>
    </div>
  );
}
