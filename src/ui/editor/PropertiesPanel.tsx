import { CATALOG } from '../../sim/catalog';
import type { Schematic, TerminalRef } from '../../sim/schematic';
import type { ComponentState, SimCommand, SimSnapshot } from '../../sim/simulation';
import { MotorView } from '../MotorView';
import type { EditorAction, Selection } from './document';

interface Props {
  schematic: Schematic;
  selection: Selection;
  dispatch(action: EditorAction): void;
  mode: 'edit' | 'sim';
  snapshot: SimSnapshot | null;
  send(command: SimCommand): void;
  onButton(component: string, pressed: boolean): void;
  heldButtons: Record<string, boolean>;
}

const POTENTIAL_TEXT: Record<string, string> = {
  P24: '+24 V',
  M0: '0 V',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  short: 'KISA DEVRE',
};

export function PropertiesPanel(props: Props) {
  const { schematic, selection, dispatch, mode, snapshot } = props;
  const nameOf = (ref: TerminalRef) =>
    `${schematic.components.find((c) => c.id === ref.component)?.name ?? '?'}:${ref.terminal}`;

  if (selection?.kind === 'wire') {
    const w = schematic.wires.find((w) => w.id === selection.id);
    if (!w) return <Shell />;
    const pot = snapshot?.potentials[`${w.a.component}:${w.a.terminal}`];
    return (
      <Shell>
        <h3>Kablo {w.id}</h3>
        <dl className="props">
          <dt>Başlangıç</dt>
          <dd className="mono">{nameOf(w.a)}</dd>
          <dt>Bitiş</dt>
          <dd className="mono">{nameOf(w.b)}</dd>
          {snapshot && (
            <>
              <dt>Potansiyel</dt>
              <dd className={`pot p-${pot ?? 'none'}`}>{pot ? POTENTIAL_TEXT[pot] : 'yok'}</dd>
            </>
          )}
        </dl>
        {mode === 'edit' && (
          <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
            Sil (Del)
          </button>
        )}
      </Shell>
    );
  }

  if (selection?.kind === 'component') {
    const c = schematic.components.find((c) => c.id === selection.id);
    if (!c) return <Shell />;
    const spec = CATALOG[c.type];
    const state = snapshot?.components[c.id];
    return (
      <Shell>
        <h3>{spec.title}</h3>
        <dl className="props">
          <dt>Etiket</dt>
          <dd>
            <input
              key={c.id + c.name}
              defaultValue={c.name}
              disabled={mode !== 'edit'}
              onBlur={(e) => dispatch({ type: 'rename', id: c.id, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </dd>
          <dt>Konum</dt>
          <dd className="mono">
            X {c.x} · Y {c.y} · {c.rotation}°
          </dd>
        </dl>
        {mode === 'edit' && (
          <div className="btn-row">
            <button type="button" onClick={() => dispatch({ type: 'rotate', id: c.id })}>
              Döndür (R)
            </button>
            <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
              Sil (Del)
            </button>
          </div>
        )}
        {state && <LiveState id={c.id} name={c.name} state={state} {...props} />}
        <h4>Terminaller</h4>
        <table className="terms">
          <tbody>
            {spec.terminals.map((t) => {
              const links = schematic.wires
                .filter((w) => (w.a.component === c.id && w.a.terminal === t) || (w.b.component === c.id && w.b.terminal === t))
                .map((w) => nameOf(w.a.component === c.id && w.a.terminal === t ? w.b : w.a));
              const pot = snapshot?.potentials[`${c.id}:${t}`];
              return (
                <tr key={t}>
                  <td className="mono">{t}</td>
                  <td className="mono">{links.length ? links.join(', ') : <span className="muted">—</span>}</td>
                  {snapshot && <td className={`pot p-${pot ?? 'none'}`}>{pot ? POTENTIAL_TEXT[pot] : ''}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Shell>
    );
  }

  return (
    <Shell>
      <h3>Proje</h3>
      <dl className="props">
        <dt>Eleman</dt>
        <dd>{schematic.components.length}</dd>
        <dt>Kablo</dt>
        <dd>{schematic.wires.length}</dd>
      </dl>
      <h4>Kısayollar</h4>
      <ul className="shortcuts">
        <li><kbd>Sürükle</kbd> kütüphaneden eleman ekle</li>
        <li><kbd>Terminal → terminal</kbd> kablo çiz</li>
        <li><kbd>Tekerlek</kbd> imleçte zoom</li>
        <li><kbd>Boş alan / orta tuş</kbd> kaydır</li>
        <li><kbd>R</kbd> döndür · <kbd>Del</kbd> sil</li>
        <li><kbd>F5</kbd> simülasyon modu · <kbd>Boşluk</kbd> başlat/duraklat</li>
        <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> geri al / yinele</li>
        <li><kbd>F</kbd> tümünü sığdır · <kbd>Esc</kbd> iptal</li>
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <aside className="dock properties">
      <header className="dock-title">Özellikler</header>
      <div className="dock-body">{children}</div>
    </aside>
  );
}

function LiveState({
  id,
  name,
  state,
  send,
  onButton,
  heldButtons,
}: Props & { id: string; name: string; state: ComponentState }) {
  switch (state.type) {
    case 'estop':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p>
            <Lamp on={!state.pressed} fault={state.pressed} /> {state.pressed ? 'BASILI (kilitli)' : 'Serbest'} · kontak{' '}
            {state.contactClosed ? 'kapalı' : 'açık'}
          </p>
          <button type="button" onClick={() => onButton(id, !state.pressed)}>
            {state.pressed ? 'Kilidi aç (çevir)' : 'Bas'}
          </button>
        </div>
      );
    case 'breaker3':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p>
            <Lamp on={state.closed} /> {state.closed ? 'Kapalı (I)' : 'Açık (O)'}
          </p>
          <button type="button" onClick={() => send({ type: 'switch', component: id, closed: !state.closed })}>
            {state.closed ? 'Aç (O)' : 'Kapat (I)'}
          </button>
        </div>
      );
    case 'lamp':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p>
            <Lamp on={state.lit} /> {state.lit ? 'Yanıyor' : 'Sönük'}
          </p>
        </div>
      );
    case 'buttonNO':
    case 'buttonNC':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p>
            <Lamp on={state.pressed} /> {state.pressed ? 'Basılı' : 'Serbest'} · kontak {state.contactClosed ? 'kapalı' : 'açık'}
          </p>
          <button type="button" onClick={() => onButton(id, !heldButtons[id])}>
            {heldButtons[id] ? 'Bırak' : 'Basılı tut'}
          </button>
        </div>
      );
    case 'contactor':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p><Lamp on={state.coilEnergized} /> Bobin {state.coilEnergized ? 'enerjili' : 'enerjisiz'}</p>
          <p><Lamp on={state.closed} /> Ana kontaklar {state.closed ? 'kapalı' : 'açık'}</p>
        </div>
      );
    case 'thermal': {
      const heat = Math.min(state.theta / state.tripTheta, 1);
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p><Lamp on={!state.tripped} fault={state.tripped} /> {state.tripped ? 'ATTI (95-96 açık)' : 'Normal'}</p>
          <p className="mono">I = {state.currentA.toFixed(2)} A · Ir = {state.setCurrentA} A</p>
          <div className="heat" title="Isıl durum / açma eşiği">
            <div style={{ width: `${heat * 100}%` }} />
          </div>
          <div className="btn-row">
            <button type="button" onClick={() => send({ type: 'thermalTest', component: id })}>Test (açtır)</button>
            <button type="button" onClick={() => send({ type: 'thermalReset', component: id })}>Reset</button>
          </div>
        </div>
      );
    }
    case 'motor3':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <MotorView motor={state} name={name} />
        </div>
      );
    case 'plc':
      return (
        <div className="live">
          <h4>Canlı durum</h4>
          <p><Lamp on={state.powered} /> {state.powered ? 'RUN' : 'Besleme yok'} · scan #{state.scanCount}</p>
        </div>
      );
    default:
      return null;
  }
}

function Lamp({ on, fault }: { on: boolean; fault?: boolean }) {
  return <span className={`lamp${fault ? ' fault' : on ? ' on' : ''}`} />;
}
