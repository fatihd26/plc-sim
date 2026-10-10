import { PLC_DI, PLC_DQ } from '../sim/catalog';
import type { ComponentState } from '../sim/simulation';
import type { SymbolTable } from '../sim/symbolTable';

type PlcState = Extract<ComponentState, { type: 'plc' }>;

function Bit({ on }: { on: boolean }) {
  return <span className={`bit ${on ? 'on' : ''}`}>{on ? '1' : '0'}</span>;
}

/**
 * Fiziksel terminal ile process image'ı yan yana göstererek scan gecikmesini görünür kılar.
 * Bağlantı sütunu sembol tablosundan gelir: klemens, bağlantı noktası ve sayfa geçişleri üzerinden.
 */
export function IoTable({ plc, symbols }: { plc: PlcState; symbols: SymbolTable }) {
  const row = (terminal: string, before: boolean, after: boolean) => (
    <tr key={terminal}>
      <td className="mono">%{terminal}</td>
      <td className="mono">{symbols[`%${terminal}`]?.join(', ') || <span className="muted">—</span>}</td>
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
