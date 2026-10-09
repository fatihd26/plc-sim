import { PLC_DI, PLC_DQ } from '../sim/catalog';
import type { Schematic } from '../sim/schematic';
import type { ComponentState } from '../sim/simulation';

type PlcState = Extract<ComponentState, { type: 'plc' }>;

function Bit({ on }: { on: boolean }) {
  return <span className={`bit ${on ? 'on' : ''}`}>{on ? '1' : '0'}</span>;
}

/** Terminale kabloyla bağlı uçların etiketleri ("S1:14"). */
function connections(schematic: Schematic, plcId: string, terminal: string): string {
  const name = (id: string) => schematic.components.find((c) => c.id === id)?.name ?? id;
  return schematic.wires
    .flatMap((w) => {
      if (w.a.component === plcId && w.a.terminal === terminal) return [`${name(w.b.component)}:${w.b.terminal}`];
      if (w.b.component === plcId && w.b.terminal === terminal) return [`${name(w.a.component)}:${w.a.terminal}`];
      return [];
    })
    .join(', ');
}

/** Fiziksel terminal ile process image'ı yan yana göstererek scan gecikmesini görünür kılar. */
export function IoTable({ plc, plcId, schematic }: { plc: PlcState; plcId: string; schematic: Schematic }) {
  const row = (terminal: string, before: boolean, after: boolean) => (
    <tr key={terminal}>
      <td className="mono">%{terminal}</td>
      <td className="mono">{connections(schematic, plcId, terminal) || <span className="muted">—</span>}</td>
      <td><Bit on={before} /></td>
      <td><Bit on={after} /></td>
    </tr>
  );
  return (
    <table className="io">
      <thead>
        <tr>
          <th>Adres</th>
          <th>Bağlantı</th>
          <th>Önce</th>
          <th>Sonra</th>
        </tr>
      </thead>
      <tbody>
        <tr className="group">
          <td colSpan={4}>Girişler: terminal → PII (scan başında)</td>
        </tr>
        {PLC_DI.map((t, i) => row(t, plc.diTerminals[i]!, plc.pii[i]!))}
        <tr className="group">
          <td colSpan={4}>Çıkışlar: PIQ → terminal (scan sonunda)</td>
        </tr>
        {PLC_DQ.map((t, i) => row(t, plc.piq[i]!, plc.dqTerminals[i]!))}
      </tbody>
    </table>
  );
}
