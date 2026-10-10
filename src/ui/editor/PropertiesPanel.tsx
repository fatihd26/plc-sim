import type { ReactNode } from 'react';
import { CATALOG, paramOf, terminalsOf, titleOf, type ParamSpec } from '../../sim/catalog';
import { pagesOf, type ComponentInstance, type Schematic, type TerminalRef } from '../../sim/schematic';
import type { ComponentState, SimCommand, SimSnapshot } from '../../sim/simulation';
import { MotorView } from '../MotorView';
import { single, type EditorAction, type Selection } from './document';
import { xrefTargets } from './layout';

interface Props {
  schematic: Schematic;
  selection: Selection;
  dispatch(action: EditorAction): void;
  mode: 'edit' | 'sim';
  snapshot: SimSnapshot | null;
  send(command: SimCommand): void;
  onButton(component: string, pressed: boolean): void;
  heldButtons: Record<string, boolean>;
  onJump(page: string, component: string): void;
  onEditProgram(plcId: string): void;
  onCopy(): void;
}

const POTENTIAL_TEXT: Record<string, string> = {
  P24: '+24 V',
  M0: '0 V',
  L1: 'L1',
  L2: 'L2',
  L3: 'L3',
  N: 'N',
  short: 'KISA DEVRE',
};

export function PropertiesPanel(props: Props) {
  const { schematic, selection, dispatch, mode, snapshot } = props;
  const edit = mode === 'edit';
  const nameOf = (ref: TerminalRef) =>
    `${schematic.components.find((c) => c.id === ref.component)?.name ?? '?'}:${ref.terminal}`;
  const one = single(selection);

  if (!one && (selection.components.length || selection.wires.length)) {
    return (
      <Shell>
        <h3>Çoklu seçim</h3>
        <dl className="props">
          <dt>Eleman</dt>
          <dd>{selection.components.length}</dd>
          <dt>Kablo</dt>
          <dd>{selection.wires.length}</dd>
        </dl>
        {edit && (
          <div className="btn-row">
            <button
              type="button"
              disabled={!selection.components.length}
              onClick={() => dispatch({ type: 'rotate', ids: selection.components })}
            >
              Döndür (R)
            </button>
            <button type="button" disabled={!selection.components.length} onClick={props.onCopy}>
              Kopyala (Ctrl+C)
            </button>
            <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
              Sil (Del)
            </button>
          </div>
        )}
        <p className="muted small">
          Seçili bir elemanı sürükleyerek tüm seçimi taşıyın. Shift/Ctrl+tık seçime ekler veya çıkarır.
        </p>
      </Shell>
    );
  }

  if (one?.kind === 'wire') {
    const w = schematic.wires.find((w) => w.id === one.id);
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
          <dt>Güzergâh</dt>
          <dd>{w.points ? `elle (${w.points.length} nokta)` : 'otomatik'}</dd>
          {snapshot && (
            <>
              <dt>Potansiyel</dt>
              <dd className={`pot p-${pot ?? 'none'}`}>{pot ? POTENTIAL_TEXT[pot] : 'yok'}</dd>
            </>
          )}
        </dl>
        {edit && (
          <>
            <div className="btn-row">
              <button
                type="button"
                disabled={!w.points}
                onClick={() => dispatch({ type: 'setWirePoints', id: w.id, points: undefined })}
              >
                Otomatik güzergâh
              </button>
              <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
                Sil (Del)
              </button>
            </div>
            <p className="muted small">
              Kabloyu şekillendirmek için ortadaki kare tutamaçları sürükleyin. Kablonun ortasına başka bir kablo
              bırakmak bağlantı noktası oluşturur.
            </p>
          </>
        )}
      </Shell>
    );
  }

  if (one?.kind === 'component') {
    const c = schematic.components.find((c) => c.id === one.id);
    if (!c) return <Shell />;
    const spec = CATALOG[c.type];
    const state = snapshot?.components[c.id];
    const pages = pagesOf(schematic);
    return (
      <Shell>
        <h3>{titleOf(c)}</h3>
        <dl className="props">
          <dt>{c.type === 'xref' ? 'Hat adı' : 'Etiket'}</dt>
          <dd>
            <input
              key={c.id + c.name}
              defaultValue={c.name}
              disabled={!edit}
              onBlur={(e) => dispatch({ type: 'rename', id: c.id, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </dd>
          <dt>Konum</dt>
          <dd className="mono">
            X {c.x} · Y {c.y} · {c.rotation}°
          </dd>
          {spec.params.map((p) => (
            <ParamField key={p.key} spec={p} inst={c} disabled={!edit} dispatch={dispatch} />
          ))}
        </dl>
        {c.type === 'xref' && <XrefInfo schematic={schematic} c={c} pages={pages} onJump={props.onJump} />}
        {c.type === 'plc' && (
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => props.onEditProgram(c.id)}>
              {edit ? 'Programı düzenle' : 'Programı izle'}
            </button>
          </div>
        )}
        {edit && (
          <div className="btn-row">
            <button type="button" onClick={() => dispatch({ type: 'rotate', ids: [c.id] })}>
              Döndür (R)
            </button>
            <button type="button" className="danger" onClick={() => dispatch({ type: 'deleteSelection' })}>
              Sil (Del)
            </button>
          </div>
        )}
        {state && <LiveState id={c.id} name={c.name} state={state} inst={c} {...props} />}
        {c.type !== 'junction' && (
          <>
            <h4>Terminaller</h4>
            <table className="terms">
              <tbody>
                {terminalsOf(c).map((t) => {
                  const links = schematic.wires
                    .filter(
                      (w) =>
                        (w.a.component === c.id && w.a.terminal === t) || (w.b.component === c.id && w.b.terminal === t),
                    )
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
          </>
        )}
      </Shell>
    );
  }

  const events = snapshot?.events ?? [];
  return (
    <Shell>
      <h3>Proje</h3>
      <dl className="props">
        <dt>Ad</dt>
        <dd>
          <input
            key={schematic.title ?? ''}
            defaultValue={schematic.title ?? ''}
            disabled={!edit}
            onBlur={(e) => dispatch({ type: 'setTitle', title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </dd>
        <dt>Sayfa</dt>
        <dd>{pagesOf(schematic).length}</dd>
        <dt>Eleman</dt>
        <dd>{schematic.components.filter((c) => c.type !== 'junction').length}</dd>
        <dt>Kablo</dt>
        <dd>{schematic.wires.length}</dd>
      </dl>
      {snapshot && (
        <>
          <h4>Olaylar</h4>
          {events.length ? (
            <ul className="events">
              {[...events].reverse().map((ev, i) => (
                <li key={`${ev.tick}-${i}`}>
                  <span className="mono muted">{(ev.tick / 1000).toFixed(3)} s</span> {ev.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Henüz koruma olayı yok.</p>
          )}
        </>
      )}
      <h4>Kısayollar</h4>
      <ul className="shortcuts">
        <li><kbd>Sürükle</kbd> kütüphaneden eleman ekle</li>
        <li><kbd>Terminal → terminal</kbd> kablo çiz; kablonun ortasına bırak: dallan</li>
        <li><kbd>Boş alanda sürükle</kbd> kutu ile seç (sağdan sola: değenler)</li>
        <li><kbd>Shift/Ctrl+tık</kbd> seçime ekle/çıkar · <kbd>Ctrl+A</kbd> tümü</li>
        <li><kbd>Ctrl+C</kbd> / <kbd>Ctrl+X</kbd> / <kbd>Ctrl+V</kbd> / <kbd>Ctrl+D</kbd> kopyala / kes / yapıştır / çoğalt</li>
        <li><kbd>Tekerlek</kbd> imleçte zoom · <kbd>Orta/sağ tuş</kbd> kaydır</li>
        <li><kbd>R</kbd> döndür · <kbd>Del</kbd> sil · <kbd>Esc</kbd> iptal</li>
        <li><kbd>PgUp</kbd> / <kbd>PgDn</kbd> önceki / sonraki sayfa</li>
        <li><kbd>F5</kbd> simülasyon modu · <kbd>Boşluk</kbd> başlat/duraklat</li>
        <li><kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Y</kbd> geri al / yinele · <kbd>F</kbd> sığdır</li>
      </ul>
    </Shell>
  );
}

function ParamField({
  spec,
  inst,
  disabled,
  dispatch,
}: {
  spec: ParamSpec;
  inst: ComponentInstance;
  disabled: boolean;
  dispatch(action: EditorAction): void;
}) {
  const value = paramOf(inst, spec.key);
  const set = (v: number | string) => dispatch({ type: 'setParam', id: inst.id, key: spec.key, value: v });
  return (
    <>
      <dt>{spec.label}</dt>
      <dd>
        {spec.kind === 'number' ? (
          <span className="param-num">
            <input
              key={`${inst.id}-${spec.key}-${value}`}
              type="number"
              defaultValue={value}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              disabled={disabled}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (e.target.value === '' || !Number.isFinite(v)) e.target.value = String(value);
                else set(Math.min(spec.max, Math.max(spec.min, v)));
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            {spec.unit && <span className="muted">{spec.unit}</span>}
          </span>
        ) : (
          <select value={String(value)} disabled={disabled} onChange={(e) => set(e.target.value)}>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </dd>
    </>
  );
}

function XrefInfo({
  schematic,
  c,
  pages,
  onJump,
}: {
  schematic: Schematic;
  c: ComponentInstance;
  pages: { id: string; title: string }[];
  onJump(page: string, component: string): void;
}) {
  const targets = xrefTargets(schematic, c);
  return (
    <>
      <h4>Karşı sayfalar</h4>
      {targets.length ? (
        <ul className="xref-list">
          {targets.map((t) => (
            <li key={t.component}>
              <button type="button" onClick={() => onJump(t.page, t.component)}>
                {t.label} {pages.find((p) => p.id === t.page)?.title} →
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">
          Başka sayfada "{c.name}" adlı geçiş yok. Aynı adı taşıyan geçişler elektriksel olarak bağlıdır.
        </p>
      )}
    </>
  );
}

function Shell({ children }: { children?: ReactNode }) {
  return (
    <aside className="dock properties">
      <header className="dock-title">Özellikler</header>
      <div className="dock-body">{children}</div>
    </aside>
  );
}

function Live({ children }: { children: ReactNode }) {
  return (
    <div className="live">
      <h4>Canlı durum</h4>
      {children}
    </div>
  );
}

function LiveState({
  id,
  name,
  state,
  inst,
  send,
  onButton,
  heldButtons,
}: Props & { id: string; name: string; state: ComponentState; inst: ComponentInstance }) {
  switch (state.type) {
    case 'estop':
      return (
        <Live>
          <p>
            <Lamp on={!state.pressed} fault={state.pressed} /> {state.pressed ? 'BASILI (kilitli)' : 'Serbest'} · kontak{' '}
            {state.contactClosed ? 'kapalı' : 'açık'}
          </p>
          <button type="button" onClick={() => onButton(id, !state.pressed)}>
            {state.pressed ? 'Kilidi aç (çevir)' : 'Bas'}
          </button>
        </Live>
      );
    case 'breaker3': {
      const heat = Math.min(state.theta / state.tripTheta, 1);
      return (
        <Live>
          <p>
            <Lamp on={state.closed} fault={state.tripped} />{' '}
            {state.tripped ? 'AÇTI (koruma)' : state.closed ? 'Kapalı (I)' : 'Açık (O)'}
          </p>
          <p className="mono">
            I = {state.currentA.toFixed(2)} A · Ir = {state.setCurrentA} A
          </p>
          <div className="heat" title="Isıl durum / açma eşiği">
            <div style={{ width: `${heat * 100}%` }} />
          </div>
          <button type="button" onClick={() => send({ type: 'switch', component: id, closed: !state.closed })}>
            {state.closed ? 'Aç (O)' : 'Kapat (I)'}
          </button>
        </Live>
      );
    }
    case 'fuse':
      return (
        <Live>
          <p>
            <Lamp on={state.closed} fault={state.tripped} />{' '}
            {state.tripped ? 'AÇTI (kısa devre)' : state.closed ? 'Kapalı' : 'Açık'}
          </p>
          <button type="button" onClick={() => send({ type: 'switch', component: id, closed: !state.closed })}>
            {state.closed ? 'Aç' : 'Kapat'}
          </button>
        </Live>
      );
    case 'psu24':
      return (
        <Live>
          <p>
            <Lamp on={!state.limited} fault={state.limited} />{' '}
            {state.limited ? 'Akım sınırlamasında (kısa devre)' : 'Çıkış normal'}
          </p>
        </Live>
      );
    case 'lamp':
      return (
        <Live>
          <p>
            <Lamp on={state.lit} fault={!!state.fault} /> {state.fault ?? (state.lit ? 'Yanıyor' : 'Sönük')}
          </p>
        </Live>
      );
    case 'buttonNO':
    case 'buttonNC':
      return (
        <Live>
          <p>
            <Lamp on={state.pressed} /> {state.pressed ? 'Basılı' : 'Serbest'} · kontak {state.contactClosed ? 'kapalı' : 'açık'}
          </p>
          <button type="button" onClick={() => onButton(id, !heldButtons[id])}>
            {heldButtons[id] ? 'Bırak' : 'Basılı tut'}
          </button>
        </Live>
      );
    case 'contactor':
      return (
        <Live>
          <p>
            <Lamp on={state.coilEnergized} fault={!!state.fault} /> Bobin{' '}
            {state.fault ?? (state.coilEnergized ? 'enerjili' : 'enerjisiz')}
          </p>
          <p>
            <Lamp on={state.closed} /> Ana kontaklar {state.closed ? 'kapalı' : 'açık'}
          </p>
        </Live>
      );
    case 'thermal': {
      const heat = Math.min(state.theta / state.tripTheta, 1);
      return (
        <Live>
          <p>
            <Lamp on={!state.tripped} fault={state.tripped} /> {state.tripped ? 'ATTI (95-96 açık)' : 'Normal'}
          </p>
          <p className="mono">
            I = {state.currentA.toFixed(2)} A · Ir = {state.setCurrentA} A
          </p>
          <div className="heat" title="Isıl durum / açma eşiği">
            <div style={{ width: `${heat * 100}%` }} />
          </div>
          <div className="btn-row">
            <button type="button" onClick={() => send({ type: 'thermalTest', component: id })}>
              Test (açtır)
            </button>
            <button type="button" onClick={() => send({ type: 'thermalReset', component: id })}>
              Reset
            </button>
          </div>
        </Live>
      );
    }
    case 'motor3':
      return (
        <Live>
          <MotorView motor={state} name={name} />
        </Live>
      );
    case 'plc':
      return (
        <Live>
          <p>
            <Lamp on={state.powered} /> {state.powered ? 'RUN' : 'Besleme yok'} · scan #{state.scanCount}
          </p>
        </Live>
      );
    case 'custom': {
      const poles = inst.custom?.poles ?? [];
      const push = poles.some((p) => p.kind === 'pushNO' || p.kind === 'pushNC');
      return (
        <Live>
          {state.fault && (
            <p>
              <Lamp on={false} fault /> {state.fault}
            </p>
          )}
          <table className="terms">
            <tbody>
              {poles.map((p, i) => (
                <tr key={i}>
                  <td className="mono">
                    {p.top}-{p.bottom}
                  </td>
                  <td>{p.kind}</td>
                  <td>
                    <Lamp on={state.poles[i] ?? false} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {push && (
            <button type="button" onClick={() => onButton(id, !heldButtons[id])}>
              {heldButtons[id] ? 'Bırak' : 'Basılı tut'}
            </button>
          )}
        </Live>
      );
    }
    default:
      return null;
  }
}

function Lamp({ on, fault }: { on: boolean; fault?: boolean }) {
  return <span className={`lamp${fault ? ' fault' : on ? ' on' : ''}`} />;
}
