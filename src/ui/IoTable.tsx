import { PLC_DI, PLC_DQ } from '../sim/catalog';
import { parseFunc } from '../sim/address';
import { isCounter, isTimer, type LadderProgram } from '../sim/ladder';
import { formatMs } from './LadderView';
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
export function IoTable({ plc, symbols, program }: { plc: PlcState; symbols: SymbolTable; program?: LadderProgram }) {
  // Programda kullanılan zamanlayıcı ve sayıcılar (adres sırasıyla, tekrarsız).
  const funcs = new Map<string, { type: string; preset: number; index: number }>();
  for (const n of program?.networks ?? []) {
    const f = parseFunc(n.coil.address);
    if (f && (isTimer(n.coil.type) || isCounter(n.coil.type))) {
      funcs.set(n.coil.address, { type: n.coil.type!, preset: n.coil.preset ?? 0, index: f.index });
    }
  }
  const funcRows = [...funcs.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
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
        {funcRows.length > 0 && (
          <tr className="group">
            <td colSpan={4}>Zamanlayıcı / sayıcı: değer / ön ayar, Q</td>
          </tr>
        )}
        {funcRows.map(([addr, f]) => {
          const timer = addr.startsWith('T');
          const st = timer ? plc.timers[f.index] : plc.counters[f.index];
          const value = timer ? formatMs((st as { et: number }).et) : String((st as { cv: number }).cv);
          return (
            <tr key={addr}>
              <td className="mono">{addr}</td>
              <td className="mono">{f.type}</td>
              <td className="mono">
                {value} / {timer ? formatMs(f.preset) : f.preset}
              </td>
              <td>
                <Bit on={st?.q ?? false} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
