import { FieldPanel } from './FieldPanel';
import { IoTable } from './IoTable';
import { LadderView } from './LadderView';
import { MotorView } from './MotorView';
import { useSimulation } from './useSimulation';

export function App() {
  const sim = useSimulation();
  const { snapshot, running } = sim;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>PLC Simülatörü</h1>
        <div className="controls">
          {running ? (
            <button type="button" onClick={sim.pause}>⏸ Duraklat</button>
          ) : (
            <button type="button" className="primary" onClick={sim.start}>▶ Başlat</button>
          )}
          <button type="button" onClick={sim.stepTick} disabled={running}>+1 ms</button>
          <button type="button" onClick={sim.stepScan} disabled={running}>+1 scan</button>
          <button type="button" onClick={sim.reset}>↺ Sıfırla</button>
        </div>
        <div className="clock mono">
          t = {(snapshot.timeMs / 1000).toFixed(3)} s · scan #{snapshot.plc.scanCount} · T<sub>scan</sub> ={' '}
          {snapshot.plc.scanTimeMs} ms
        </div>
      </header>

      <main className="layout">
        <FieldPanel key={sim.generation} snapshot={snapshot} running={running} send={sim.send} />

        <section className="panel">
          <h2>PLC programı (online izleme)</h2>
          <LadderView networks={sim.program.networks} trace={snapshot.plc.trace} />
          <h2>I/O</h2>
          <IoTable plc={snapshot.plc} />
        </section>

        <section className="panel">
          <h2>Motor</h2>
          <MotorView motor={snapshot.M1} />
        </section>
      </main>
    </div>
  );
}
