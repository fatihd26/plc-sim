import type { IoPoint, SimSnapshot } from '../sim/simulation';

function Bit({ on }: { on: boolean }) {
  return <span className={`bit ${on ? 'on' : ''}`}>{on ? '1' : '0'}</span>;
}

function Rows({ points, kind }: { points: IoPoint[]; kind: 'in' | 'out' }) {
  return (
    <>
      {points.map((p) => (
        <tr key={p.address}>
          <td className="mono">{p.address}</td>
          <td>{p.label}</td>
          {kind === 'in' ? (
            <>
              <td><Bit on={p.terminal} /></td>
              <td><Bit on={p.image} /></td>
            </>
          ) : (
            <>
              <td><Bit on={p.image} /></td>
              <td><Bit on={p.terminal} /></td>
            </>
          )}
        </tr>
      ))}
    </>
  );
}

/** Fiziksel terminal ile process image'ı yan yana göstererek scan gecikmesini görünür kılar. */
export function IoTable({ plc }: { plc: SimSnapshot['plc'] }) {
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
        <Rows points={plc.inputs} kind="in" />
        <tr className="group">
          <td colSpan={4}>Çıkışlar: PIQ → terminal (scan sonunda)</td>
        </tr>
        <Rows points={plc.outputs} kind="out" />
      </tbody>
    </table>
  );
}
