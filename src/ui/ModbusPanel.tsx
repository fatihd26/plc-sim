// PLC Modbus RTU master tarama tablosu: düzenleme (satır ekle/sil, işlev, adresler, periyot) ve
// simülasyonda satır başına canlı durum.

import { useState } from 'react';
import { POLL_FUNCTIONS, validatePoll, type ModbusPoll, type PollFn, type PollStatus } from '../sim/modbusMaster';

const STATE_TEXT: Record<PollStatus['state'], string> = {
  idle: 'bekliyor',
  ok: 'OK',
  timeout: 'zaman aşımı',
  exception: 'istisna',
  busFault: 'bus hatası',
  invalid: 'geçersiz satır',
};

/** Yeni satır: önceki satırın slave adresiyle, çakışmayan kimlikle. */
function newPoll(polls: ModbusPoll[]): ModbusPoll {
  let i = polls.length + 1;
  while (polls.some((p) => p.id === `p${i}`)) i++;
  return { id: `p${i}`, unit: polls.at(-1)?.unit ?? 1, fn: 2, remote: 0, qty: 1, local: '%M10.0', periodMs: 100 };
}

/** Değeri sayıya çevirerek alan güncelleyen sayı kutusu. */
function NumCell({ value, onChange, min, max }: { value: number; onChange(v: number): void; min: number; max: number }) {
  const [text, setText] = useState(String(value));
  const commit = () => {
    const v = Number(text);
    if (Number.isInteger(v) && v !== value) onChange(v);
    else setText(String(value));
  };
  return (
    <input
      className="mono"
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

export function ModbusPanel({
  polls,
  baud,
  onChange,
  onClose,
}: {
  polls: ModbusPoll[];
  baud: string;
  onChange(polls: ModbusPoll[]): void;
  onClose(): void;
}) {
  const set = (id: string, patch: Partial<ModbusPoll>) =>
    onChange(
      polls.map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        if (next.fn === 5 || next.fn === 6) next.qty = 1;
        return next;
      }),
    );
  return (
    <div className="modbus-panel">
      <header>
        <strong>Modbus RTU master tablosu</strong>
        <span className="muted small">
          RS485 A/B uçlarından · {baud} bit/s · slave'ler: aynı A/B netindeki, aynı baud hızındaki ESP32'ler
        </span>
        <button type="button" className="icon" aria-label="Kapat" onClick={onClose}>
          ✕
        </button>
      </header>
      <table className="modbus-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Slave</th>
            <th>İşlev</th>
            <th>Uzak adres</th>
            <th>Adet</th>
            <th>PLC adresi</th>
            <th>Periyot (ms)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {polls.map((p) => {
            const err = validatePoll(p);
            const read = POLL_FUNCTIONS.find((f) => f.fn === p.fn)?.read;
            return (
              <tr key={p.id} className={err ? 'invalid' : undefined}>
                <td className="mono">{p.id}</td>
                <td>
                  <NumCell key={`u${p.unit}`} value={p.unit} min={1} max={247} onChange={(unit) => set(p.id, { unit })} />
                </td>
                <td>
                  <select value={p.fn} onChange={(e) => set(p.id, { fn: Number(e.target.value) as PollFn })}>
                    {POLL_FUNCTIONS.map((f) => (
                      <option key={f.fn} value={f.fn}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <NumCell key={`r${p.remote}`} value={p.remote} min={0} max={65535} onChange={(remote) => set(p.id, { remote })} />
                </td>
                <td>
                  <NumCell key={`q${p.qty}${p.fn}`} value={p.qty} min={1} max={125} onChange={(qty) => set(p.id, { qty })} />
                </td>
                <td>
                  <input
                    key={`l${p.local}`}
                    className="mono"
                    defaultValue={p.local}
                    title={read ? 'Okunan değerin yazılacağı yer (%M biti / %MW)' : 'Gönderilecek değerin kaynağı (%I/%Q/%M biti / %MW)'}
                    onBlur={(e) => e.target.value.trim() !== p.local && set(p.id, { local: e.target.value.trim().toUpperCase() })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </td>
                <td>
                  <NumCell
                    key={`t${p.periodMs}`}
                    value={p.periodMs}
                    min={10}
                    max={60000}
                    onChange={(periodMs) => set(p.id, { periodMs })}
                  />
                </td>
                <td>
                  <button type="button" className="icon" title="Satırı sil" onClick={() => onChange(polls.filter((q) => q.id !== p.id))}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {polls.map((p) => {
        const err = validatePoll(p);
        return err ? (
          <p key={p.id} className="error small">
            {p.id}: {err}
          </p>
        ) : null;
      })}
      <div className="btn-row">
        <button type="button" onClick={() => onChange([...polls, newPoll(polls)])}>
          + Satır
        </button>
      </div>
      <p className="muted small">
        Okuma (FC1–4): slave'deki değer PLC adresine yazılır (bit → %M, register → %MW). Yazma (FC5, 6, 15, 16): PLC
        adresindeki değer slave'e gönderilir (bit ← %I/%Q/%M, register ← %MW). ESP32 Modbus slave haritası: coil n → çıkış
        pini, discrete input n ← giriş pini (G/Ç eşlemesindeki bit), IR0 = ADC ham, IR1 = ADC mV.
      </p>
    </div>
  );
}

/** Simülasyonda satır başına durum (I/O tablosunun altında). */
export function ModbusStatusTable({ polls, status }: { polls: ModbusPoll[]; status: PollStatus[] }) {
  const byId = new Map(status.map((s) => [s.id, s]));
  return (
    <table className="io modbus-status">
      <thead>
        <tr>
          <th colSpan={4}>Modbus master</th>
        </tr>
      </thead>
      <tbody>
        {polls.map((p) => {
          const st = byId.get(p.id);
          const fn = POLL_FUNCTIONS.find((f) => f.fn === p.fn)!;
          const values = st?.values.map((v) => (typeof v === 'boolean' ? (v ? '1' : '0') : String(v))).join(' ') ?? '';
          return (
            <tr key={p.id}>
              <td className="mono" title={fn.label}>
                {p.unit}:FC{p.fn} {p.remote}
                {p.qty > 1 ? `+${p.qty}` : ''} {fn.read ? '→' : '←'} {p.local}
              </td>
              <td className={`mb-state ${st?.state ?? 'idle'}`}>{STATE_TEXT[st?.state ?? 'idle']}</td>
              <td className="mono">{values}</td>
              <td className="mono muted" title={st?.detail ?? undefined}>
                {st ? `${st.okCount}/${st.errorCount}` : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
