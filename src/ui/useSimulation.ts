// UI ↔ çekirdek köprüsü. Çekirdek bu dosyayı tanımaz; yön her zaman UI → çekirdek.
//   Giriş: send(command)   Çıkış: snapshot (salt-okunur kopya)
// Gerçek zaman eşlemesi (pacer) burada yapılır, çekirdek duvar saatini bilmez.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Schematic } from '../sim/schematic';
import { Simulation, TICK_MS, type SimCommand, type SimSnapshot } from '../sim/simulation';

/** Sekme arka plandayken birikmiş zaman bir anda koşturulmaz. */
const MAX_TICKS_PER_FRAME = 100;

export interface SimulationControls {
  /** Şema verilmediyse (düzenleme modu) veya kurulamadıysa null. */
  snapshot: SimSnapshot | null;
  /** Şemadan simülasyon kurulamadıysa hata metni. */
  error: string | null;
  running: boolean;
  start(): void;
  pause(): void;
  stepTick(): void;
  stepScan(): void;
  reset(): void;
  /** Duraklatılmışken komut bir tick ilerletilerek hemen uygulanır. */
  send(command: SimCommand): void;
}

/** `schematic` değiştikçe simülasyon sıfırdan kurulur; null verilirse kapatılır. */
export function useSimulation(schematic: Schematic | null): SimulationControls {
  const simRef = useRef<Simulation | null>(null);
  const runningRef = useRef(false);
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  runningRef.current = running;

  const build = useCallback(() => {
    setRunning(false);
    simRef.current = null;
    setSnapshot(null);
    setError(null);
    if (!schematic) return;
    try {
      simRef.current = new Simulation(schematic);
      setSnapshot(simRef.current.snapshot());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [schematic]);

  useEffect(build, [build]);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    let pendingMs = 0;
    const frame = (now: number) => {
      const sim = simRef.current;
      if (!sim) return;
      pendingMs += now - last;
      last = now;
      const ticks = Math.min(Math.floor(pendingMs / TICK_MS), MAX_TICKS_PER_FRAME);
      pendingMs = Math.min(pendingMs - ticks * TICK_MS, TICK_MS);
      sim.run(ticks * TICK_MS);
      setSnapshot(sim.snapshot());
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const advance = useCallback((fn: (sim: Simulation) => void) => {
    const sim = simRef.current;
    if (!sim) return;
    fn(sim);
    setSnapshot(sim.snapshot());
  }, []);

  return {
    snapshot,
    error,
    running,
    start: useCallback(() => {
      if (simRef.current) setRunning(true);
    }, []),
    pause: useCallback(() => setRunning(false), []),
    stepTick: useCallback(() => advance((s) => s.step()), [advance]),
    stepScan: useCallback(() => advance((s) => s.stepScan()), [advance]),
    reset: build,
    send: useCallback(
      (command: SimCommand) => {
        simRef.current?.enqueue(command);
        if (!runningRef.current) advance((s) => s.step());
      },
      [advance],
    ),
  };
}
