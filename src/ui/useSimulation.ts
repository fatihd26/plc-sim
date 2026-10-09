// UI ↔ çekirdek köprüsü. Çekirdek bu dosyayı tanımaz; yön her zaman UI → çekirdek.
//   Giriş: send(command)   Çıkış: snapshot (salt-okunur kopya)
// Gerçek zaman eşlemesi (pacer) burada yapılır, çekirdek duvar saatini bilmez.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LadderProgram } from '../sim/ladder';
import { Simulation, TICK_MS, type SimCommand, type SimSnapshot } from '../sim/simulation';

/** Sekme arka plandayken birikmiş zaman bir anda koşturulmaz. */
const MAX_TICKS_PER_FRAME = 100;

export interface SimulationControls {
  snapshot: SimSnapshot;
  program: LadderProgram;
  running: boolean;
  /** Her sıfırlamada artar; UI-yerel durumu (basılı butonlar) temizlemek için. */
  generation: number;
  start(): void;
  pause(): void;
  stepTick(): void;
  stepScan(): void;
  reset(): void;
  send(command: SimCommand): void;
}

export function useSimulation(): SimulationControls {
  const simRef = useRef<Simulation | null>(null);
  if (simRef.current === null) simRef.current = new Simulation();
  const sim = () => simRef.current!;

  const [snapshot, setSnapshot] = useState<SimSnapshot>(() => sim().snapshot());
  const [running, setRunning] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let pendingMs = 0;
    const frame = (now: number) => {
      pendingMs += now - last;
      last = now;
      const ticks = Math.min(Math.floor(pendingMs / TICK_MS), MAX_TICKS_PER_FRAME);
      pendingMs = Math.min(pendingMs - ticks * TICK_MS, TICK_MS);
      sim().run(ticks * TICK_MS);
      setSnapshot(sim().snapshot());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const refresh = () => setSnapshot(sim().snapshot());

  return {
    snapshot,
    program: sim().config.program,
    running,
    generation,
    start: useCallback(() => setRunning(true), []),
    pause: useCallback(() => setRunning(false), []),
    stepTick: useCallback(() => {
      sim().step();
      refresh();
    }, []),
    stepScan: useCallback(() => {
      sim().stepScan();
      refresh();
    }, []),
    reset: useCallback(() => {
      simRef.current = new Simulation();
      setRunning(false);
      setGeneration((g) => g + 1);
      refresh();
    }, []),
    send: useCallback((command: SimCommand) => sim().enqueue(command), []),
  };
}
