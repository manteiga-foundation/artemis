import { useEffect, useRef } from 'react';
import { controller } from '../graph/controller';
import { useStore } from '../store';

export function GraphCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const targetMode = useStore((s) => s.targetMode);

  useEffect(() => {
    if (ref.current) controller.initMain(ref.current);
  }, []);

  return <div ref={ref} className={`graph-layer${targetMode ? ' is-targeting' : ''}`} />;
}
