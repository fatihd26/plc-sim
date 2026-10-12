import type { IoPoint } from '../sim/ioConfig';
import { parseFunc } from '../sim/address';
import { isCounter, isTimer, type LadderProgram } from '../sim/ladder';
import { formatMs } from './LadderView';
import type { PlcRuntimeState } from '../sim/simulation';
import type { SymbolTable } from '../sim/symbolTable';

function Bit({ on }: { on: boolean }) {
  return <span className={`bit ${on ? 'on' : ''}`}>{on ? '1' : '0'}</span>;
}

/**
 * Fiziksel terminal ile process image'ı yan yana göstererek scan gecikmesini görünür kılar.
 * Bağlantı sütunu sembol tablosundan gelir: klemens, bağlantı noktası ve sayfa geçişleri üzerinden.
 */
/** Process image biti: "%I0.3" → 3, "%I1.0" → 8. */
const bitOf = (address: string) => {
  const [byte, bit] = address.slice(2).split('.').map(Number) as [number, number];
  return byte * 8 + bit;
};

export function IoTable({
  plc,
  io,
  symbols,
  program,
}: {
  plc: PlcRuntimeState;
  /** Kontrolörün fiziksel G/Ç noktaları (catalog.controllerIo). */
  io: { inputs: IoPoint[]; outputs: IoPoint[] };
  symbols: SymbolTable;
  program?: LadderProgram;
}) {
  // Programda kullanılan zamanlayıcı ve sayıcılar (adres sırasıyla, tekrarsız).
  const funcs = new Map<string, { type: string; preset: number; index: number }>();
  for (const n of program?.networks ?? []) {
    const f = parseFunc(n.coil.address);
    if (f && (isTimer(n.coil.type) || isCounter(n.coil.type))) {
      funcs.set(n.coil.address, { type: n.coil.type!, preset: n.coil.preset ?? 0, index: f.index });
    }
  }
  const funcRows = [...funcs.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }));
  const row = ({ address, terminal }: IoPoint, before: boolean, after: boolean) => (
    <tr key={address}>
      <td className="mono">
        {address}
        {terminal !== address.slice(1) && <span className="muted"> {terminal}</span>}
      </td>
      <td className="mono">{symbols[address]?.join(', ') || <span className="muted">—</span>}</td>
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
        {io.inputs.map((p) => row(p, plc.diTerminals[bitOf(p.address)] ?? false, plc.pii[bitOf(p.address)] ?? false))}
        <tr className="group">
          <td colSpan={4}>Çıkışlar: PIQ → terminal (scan sonunda)</td>
        </tr>
        {io.outputs.map((p) => row(p, plc.piq[bitOf(p.address)] ?? false, plc.dqTerminals[bitOf(p.address)] ?? false))}
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
