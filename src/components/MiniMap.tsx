import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Animated, Animator, FrameCorners } from '@arwes/react';
import { controller } from '../graph/controller';
import { useIlluminator } from '../hooks';

// Bottom-left "scope" / map: a second cosmos.gl instance mirroring the main graph,
// with the main camera's viewport drawn as a rectangle. Click or drag to pan.
export function MiniMap() {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(false);

  useIlluminator(panelRef);

  useEffect(() => {
    if (canvasRef.current) controller.initMini(canvasRef.current);
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setRect(controller.viewportInMini());
        setZoom(controller.main?.getZoomLevel() ?? 1);
      });
    };
    const off = controller.onViewport(update);
    const onResize = () => window.setTimeout(() => controller.syncMini(true), 50);
    window.addEventListener('resize', onResize);
    return () => {
      off();
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const pan = (e: PointerEvent, duration: number) => {
    const b = bodyRef.current?.getBoundingClientRect();
    if (!b) return;
    controller.panToMini(e.clientX - b.left, e.clientY - b.top, duration);
  };

  const box = bodyRef.current?.getBoundingClientRect();
  const clip = (r: NonNullable<typeof rect>) => {
    if (!box) return r;
    const x1 = Math.max(0, r.x);
    const y1 = Math.max(0, r.y);
    const x2 = Math.min(box.width, r.x + r.w);
    const y2 = Math.min(box.height, r.y + r.h);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  };
  const vr = rect ? clip(rect) : null;

  return (
    <Animator>
      <Animated elementRef={panelRef} className="panel minimap" animated={['fade', ['x', -18, 0]]}>
        <Animator>
          <FrameCorners className="frame" strokeWidth={1.5} cornerLength={16} />
        </Animator>
        <div className="panel-title">
          <span>SCOPE</span>
          <span className="panel-title-dim">MAP</span>
          <span className="panel-title-right">x{zoom.toFixed(2)}</span>
        </div>
        <div className="minimap-body" ref={bodyRef}>
          <div className="minimap-canvas" ref={canvasRef} />
          {vr && vr.w > 0 && vr.h > 0 && (
            <div
              className="minimap-viewport"
              style={{ transform: `translate(${vr.x}px, ${vr.y}px)`, width: vr.w, height: vr.h }}
            />
          )}
          <div
            className="minimap-hit"
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              pan(e, 300);
            }}
            onPointerMove={(e) => dragging.current && pan(e, 0)}
            onPointerUp={() => {
              dragging.current = false;
            }}
          />
        </div>
      </Animated>
    </Animator>
  );
}
