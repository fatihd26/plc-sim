// Kontrolör G/Ç eşlemesi: hangi %I/%Q adresinin hangi fiziksel terminale (PLC terminali, ESP32
// GPIO pini) karşılık geldiğini gösterir; ESP32'de elle veya otomatik yapılandırılır. Ayrıca ladder
// adres alanları için öneri listesi ve "bu adres nereye gidiyor" ipucu sağlar.

import { createContext, useContext, useState } from 'react';
import { ESP32_PINS, strParam, type ParamValue } from '../sim/catalog';
import { autoConfigureEsp32, ESP32_ADDR_BITS, ioPointOf, usedIo, type ControllerIo } from '../sim/ioConfig';
import type { LadderProgram } from '../sim/ladder';
import type { ComponentInstance } from '../sim/schematic';
import { symbolName, type SymbolTable } from '../sim/symbolTable';

export interface IoInfo {
  controller: ComponentInstance;
  io: ControllerIo;
  symbols: SymbolTable;
  /** G/Ç eşleme panelini açar. */
  openIo(): void;
}

export const IoContext = createContext<IoInfo | null>(null);

const AREA_RE = /^%?([IQ])(\d+)\.([0-7])$/i;

/** Adres alanının altındaki ipucu: fiziksel karşılık veya uyarı. */
export function IoHint({ address }: { address: string }) {
  const info = useContext(IoContext);
  const sym = info ? symbolName(info.symbols, address) : '';
  if (/^[TC]\d/i.test(address)) {
    return <p className="muted small">{address[0]!.toUpperCase() === 'T' ? 'Zamanlayıcı' : 'Sayıcı'} çıkışı (Q)</p>;
  }
  if (!info || !AREA_RE.test(address)) {
    return <p className="muted small">{/^%?M/i.test(address) ? 'Bellek biti (fiziksel bağlantısı yok)' : `Şemada: ${sym || '—'}`}</p>;
  }
  const hit = ioPointOf(info.io, address);
  if (!hit) {
    return (
      <p className="warn small">
        ⚠ {address} {info.controller.name} üzerinde hiçbir fiziksel {/^%?I/i.test(address) ? 'girişe' : 'çıkışa'} bağlı değil.{' '}
        <button type="button" className="link" onClick={info.openIo}>
          G/Ç eşlemesi
        </button>
      </p>
    );
  }
  return (
    <p className="io-hint small">
      {hit.dir === 'in' ? 'Giriş' : 'Çıkış'} <strong className="mono">{hit.point.terminal}</strong>
      {hit.point.auto && <span className="muted"> (otomatik)</span>} · Şemada: {sym || 'bağlı eleman yok'}
    </p>
  );
}

/** Adres alanı için öneri listesi (<datalist>); `id` input'un `list` özelliğine verilir. */
export function IoDatalist({ id, outputsOnly }: { id: string; outputsOnly?: boolean }) {
  const info = useContext(IoContext);
  if (!info) return null;
  const points = [...(outputsOnly ? [] : info.io.inputs), ...info.io.outputs];
  return (
    <datalist id={id}>
      {points.map((p) => {
        const sym = symbolName(info.symbols, p.address);
        return (
          <option key={p.address} value={p.address}>
            {p.terminal}
            {sym ? ` · ${sym}` : ''}
          </option>
        );
      })}
    </datalist>
  );
}

/** G/Ç eşleme paneli (ladder editörünün sağ sütunu). */
export function IoConfigPanel({
  controller,
  io,
  symbols,
  program,
  onParams,
  onClose,
}: {
  controller: ComponentInstance;
  io: ControllerIo;
  symbols: SymbolTable;
  program: LadderProgram;
  onParams?(params: Record<string, ParamValue>): void;
  onClose(): void;
}) {
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const esp = controller.type === 'esp32';
  const used = usedIo(program);
  const usedSet = new Set([...used.inputs.map((b) => `%I${b >> 3}.${b & 7}`), ...used.outputs.map((b) => `%Q${b >> 3}.${b & 7}`)]);
  const unmapped = [...usedSet].filter((a) => !ioPointOf(io, a));
  const points = [...io.inputs.map((p) => ({ ...p, dir: 'in' as const })), ...io.outputs.map((p) => ({ ...p, dir: 'out' as const }))];
  const byPin = new Map(points.map((p) => [p.terminal, p]));

  return (
    <div className="element-form io-config">
      <h4>
        G/Ç eşlemesi · {controller.name}
        <button type="button" className="icon" aria-label="Kapat" onClick={onClose}>
          ✕
        </button>
      </h4>
      {!esp && <p className="muted small">PLC'de eşleme sabittir: I0.0 terminali %I0.0, Q0.0 terminali %Q0.0.</p>}
      <table className="terms io-map">
        <thead>
          <tr>
            <th>{esp ? 'Pin' : 'Terminal'}</th>
            {esp && <th>Yön</th>}
            {esp && <th>Adres</th>}
            <th>Etkin</th>
            <th>Şemada</th>
          </tr>
        </thead>
        <tbody>
          {(esp ? ESP32_PINS.map((pin) => byPin.get(pin)!) : points).map((p) => (
            <tr key={p.terminal} className={usedSet.has(p.address) ? 'used' : undefined}>
              <td className="mono">{p.terminal}</td>
              {esp && (
                <td>
                  <select
                    value={strParam(controller, `mode_${p.terminal}`)}
                    disabled={!onParams}
                    onChange={(e) => onParams?.({ [`mode_${p.terminal}`]: e.target.value })}
                  >
                    <option value="in">Giriş</option>
                    <option value="out">Çıkış</option>
                  </select>
                </td>
              )}
              {esp && (
                <td>
                  <select
                    value={strParam(controller, `addr_${p.terminal}`)}
                    disabled={!onParams}
                    onChange={(e) => onParams?.({ [`addr_${p.terminal}`]: e.target.value })}
                  >
                    <option value="auto">Otomatik</option>
                    {Array.from({ length: ESP32_ADDR_BITS }, (_, n) => (
                      <option key={n} value={String(n)}>
                        {p.dir === 'in' ? '%I' : '%Q'}0.{n}
                      </option>
                    ))}
                  </select>
                </td>
              )}
              <td className="mono">
                {p.address}
                {p.auto && <span className="muted"> oto</span>}
              </td>
              <td className="mono">{symbolName(symbols, p.address) || <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {io.errors.map((e) => (
        <p key={e} className="error small">
          {e}
        </p>
      ))}
      {unmapped.length > 0 && (
        <p className="warn small">⚠ Programda kullanılıp hiçbir pine bağlı olmayan adres: {unmapped.join(', ')}</p>
      )}
      <p className="muted small">Kalın satırlar programda kullanılan adreslerdir.</p>
      {esp && onParams && (
        <div className="btn-row">
          <button
            type="button"
            className="primary"
            title="Programın kullandığı %I/%Q adreslerine göre pin yönlerini ve adreslerini ayarlar; mevcut eşlemeyi korur"
            onClick={() => {
              const r = autoConfigureEsp32(program, controller);
              if ('error' in r) return setNote({ text: r.error, error: true });
              onParams(r.params);
              setNote({ text: r.changes.length ? r.changes.join(' · ') : 'Pinler programa göre ayarlandı.' });
            }}
          >
            Programdan otomatik
          </button>
          <button
            type="button"
            title="Tüm pin adreslerini otomatiğe çevirir (yönler korunur)"
            onClick={() => {
              onParams(Object.fromEntries(ESP32_PINS.map((pin) => [`addr_${pin}`, 'auto'])));
              setNote({ text: 'Tüm adresler otomatik: girişler %I0.0, çıkışlar %Q0.0 adresinden pin sırasıyla.' });
            }}
          >
            Tümü otomatik
          </button>
        </div>
      )}
      {note && <p className={note.error ? 'error small' : 'muted small'}>{note.text}</p>}
    </div>
  );
}
