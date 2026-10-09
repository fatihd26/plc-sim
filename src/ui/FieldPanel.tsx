import { useState } from 'react';
import type { ButtonId, SimCommand, SimSnapshot } from '../sim/simulation';

interface Props {
  snapshot: SimSnapshot;
  running: boolean;
  send(command: SimCommand): void;
}

/**
 * Basılı tutulan (momentary) buton. Duraklatılmışken tıklama basılı/bırakılmış arasında
 * geçiş yapar; aksi halde bas-bırak aynı tick'e düşer ve adım adım izlenemez.
 */
function MomentaryButton({ id, label, color, running, send }: {
  id: ButtonId;
  label: string;
  color: 'green' | 'red';
  running: boolean;
  send(command: SimCommand): void;
}) {
  const [held, setHeld] = useState(false);
  const set = (pressed: boolean) => {
    if (pressed === held) return;
    setHeld(pressed);
    send({ type: 'button', id, pressed });
  };

  return (
    <button
      type="button"
      className={`push ${color}${held ? ' held' : ''}`}
      aria-pressed={held}
      onPointerDown={running ? () => set(true) : undefined}
      onPointerUp={running ? () => set(false) : undefined}
      onPointerLeave={running ? () => set(false) : undefined}
      onClick={running ? undefined : () => set(!held)}
    >
      <span className="cap" />
      <span>
        {id} {label}
      </span>
    </button>
  );
}

export function FieldPanel({ snapshot, running, send }: Props) {
  const { K1, F2 } = snapshot;
  const heat = Math.min(F2.theta / F2.tripTheta, 1);

  return (
    <section className="panel field">
      <h2>Saha</h2>
      <div className="buttons">
        <MomentaryButton id="S1" label="Start" color="green" running={running} send={send} />
        <MomentaryButton id="S2" label="Stop" color="red" running={running} send={send} />
      </div>
      <p className="hint">{running ? 'Butonlar basılı tutulduğu sürece etkindir.' : 'Duraklatıldı: tıklama butonu basılı bırakır.'}</p>

      <div className={`device ${K1.closed ? 'on' : ''}`}>
        <h3>K1 Kontaktör</h3>
        <div className="row">
          <span className={`lamp ${K1.coilEnergized ? 'on' : ''}`} /> Bobin (A1-A2)
        </div>
        <div className="row">
          <span className={`lamp ${K1.closed ? 'on' : ''}`} /> Ana kontaklar {K1.closed ? 'kapalı' : 'açık'}
        </div>
      </div>

      <div className={`device ${F2.tripped ? 'fault' : ''}`}>
        <h3>F2 Termik röle ({F2.setCurrentA} A)</h3>
        <div className="row">
          <span className={`lamp ${F2.tripped ? 'fault' : 'on'}`} /> 95-96 {F2.tripped ? 'AÇIK (attı)' : 'kapalı'}
        </div>
        <div className="heat" title="Isıl durum (açma eşiğine oran)">
          <div style={{ width: `${heat * 100}%` }} />
        </div>
        <div className="row actions">
          <button type="button" onClick={() => send({ type: 'thermalTest' })}>
            Test (açtır)
          </button>
          <button type="button" onClick={() => send({ type: 'thermalReset' })}>
            Reset
          </button>
        </div>
      </div>
    </section>
  );
}
