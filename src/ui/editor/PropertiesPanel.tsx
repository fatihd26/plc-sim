import type { ReactNode } from 'react';
import { ANALOG_FULL } from '../../sim/address';
import { CATALOG, paramOf, terminalsOf, titleOf, type ParamSpec } from '../../sim/catalog';
import { faultsOf, pagesOf, type ComponentInstance, type Schematic, type TerminalRef } from '../../sim/schematic';
import { componentSignals, providesOf } from '../../sim/signals';
import type { ComponentState, Signal, SimCommand, SimSnapshot } from '../../sim/simulation';
import { viewOf } from '../devices';
import { numOf, type Control } from '../devices/types';
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
    const sig = snapshot?.signals[`${w.a.component}:${w.a.terminal}`];
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
          {sig && (
            <>
              <dt>Sinyal</dt>
              <dd className="mono">{signalText(sig)}</dd>
            </>
          )}
        </dl>
        {!(schematic.hideFaults && !edit) && (
          <label className="check">
            <input
              type="checkbox"
              checked={edit ? !!w.broken : (snapshot?.brokenWires.includes(w.id) ?? false)}
              onChange={(e) =>
                edit
                  ? dispatch({ type: 'setWireBroken', id: w.id, broken: e.target.checked })
                  : props.send({ type: 'wireFault', component: w.id, broken: e.target.checked })
              }
            />
            Kablo kopuk {edit ? '(simülasyon başında)' : '(arıza)'}
          </label>
        )}
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
            <ParamField key={p.key} spec={p} inst={c} disabled={!edit} dispatch={dispatch} schematic={schematic} />
          ))}
        </dl>
        {c.type === 'xref' && <XrefInfo schematic={schematic} c={c} pages={pages} onJump={props.onJump} />}
        {(c.type === 'plc' || c.type === 'esp32') && (
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
        {state && <SignalTable state={state} />}
        <FaultSection c={c} {...props} />
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
      {edit && (
        <label className="check">
          <input
            type="checkbox"
            checked={!!schematic.hideFaults}
            onChange={(e) => dispatch({ type: 'setHideFaults', hide: e.target.checked })}
          />
          Başlangıç arızalarını ve kopuk kabloları simülasyonda gizle (arıza bulma alıştırması)
        </label>
      )}
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
  schematic,
}: {
  spec: ParamSpec;
  inst: ComponentInstance;
  disabled: boolean;
  dispatch(action: EditorAction): void;
  schematic: Schematic;
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
        ) : spec.kind === 'target' ? (
          <select value={String(value)} disabled={disabled} onChange={(e) => set(e.target.value)}>
            <option value="">— yok (simülasyonda elle) —</option>
            {schematic.components
              .filter((o) => o.id !== inst.id && providesOf(o.type).includes(spec.accepts))
              .map((o) => (
                <option key={o.id} value={o.name}>
                  {o.name} ({titleOf(o)})
                </option>
              ))}
            {value !== '' && !schematic.components.some((o) => o.name === value) && (
              <option value={String(value)}>{String(value)} (şemada yok)</option>
            )}
          </select>
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
    case 'relay':
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
          <table className="terms">
            <tbody>
              {state.ai.map((a, i) => (
                <tr key={`ai${i}`}>
                  <td className="mono">AI{i} %IW{i}</td>
                  <td className="mono">{a.raw >= 32767 ? '32767 (taşma / kablo kopuk)' : a.raw}</td>
                  <td className="muted small">
                    {a.type === '4-20mA'
                      ? `${(4 + (a.raw * 16) / ANALOG_FULL).toFixed(1)} mA`
                      : `${((a.raw * 10) / ANALOG_FULL).toFixed(2)} V`}
                  </td>
                </tr>
              ))}
              {state.aq.map((v, i) => (
                <tr key={`aq${i}`}>
                  <td className="mono">AQ{i} %QW{i}</td>
                  <td className="mono">{v}</td>
                  <td className="muted small">{((Math.max(0, Math.min(ANALOG_FULL, v)) * 10) / ANALOG_FULL).toFixed(2)} V</td>
                </tr>
              ))}
              {state.hsc.map((v, i) =>
                v === null ? null : (
                  <tr key={`hc${i}`}>
                    <td className="mono">HC{i}</td>
                    <td className="mono">{v}</td>
                    <td className="muted small">hızlı sayıcı</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </Live>
      );
    case 'esp32':
      return (
        <Live>
          <p>
            <Lamp on={state.powered} /> {state.powered ? `Çalışıyor · döngü #${state.loopCount}` : 'Besleme yok (24V-GND)'}
          </p>
          <table className="terms">
            <tbody>
              {state.pins.map((p) => (
                <tr key={p.pin}>
                  <td className="mono">{p.pin}</td>
                  <td className="mono">{p.mode === 'in' ? `%I0.${p.bit}` : `%Q0.${p.bit}`}</td>
                  <td>
                    <Lamp on={p.on} />
                  </td>
                  <td>
                    {p.mode === 'out' && state.firmware === 'modbusSlave' && (
                      <button
                        type="button"
                        className="small"
                        disabled={!state.powered}
                        title="Test master: coil'e FC5 ile yaz"
                        onClick={() =>
                          send({ type: 'modbusWrite', component: id, request: { fn: 5, addr: p.bit, value: !state.coils[p.bit] } })
                        }
                      >
                        coil {p.bit} = {state.coils[p.bit] ? 0 : 1}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label>
            ADC1: {(state.adcMv / 1000).toFixed(2)} V · ham {state.adcRaw}
            <input
              type="range"
              min={0}
              max={10_000}
              step={100}
              value={state.adcMv}
              onChange={(e) => send({ type: 'analog', component: id, mv: Number(e.target.value) })}
            />
          </label>
          <p className="mono small">
            Modbus adres {state.slaveId} · IR0 {state.inputRegisters[0]} · IR1 {state.inputRegisters[1]} mV · HR0..3{' '}
            {state.holdingRegisters.join(' ')}
          </p>
          <p className="small">
            <Lamp on={state.busPeers.length > 0} fault={!!state.rs485Fault} /> RS485:{' '}
            {state.rs485Fault ?? (state.busPeers.length ? `bus'ta ${state.busPeers.join(', ')}` : 'bağlı cihaz yok')}
          </p>
          {state.firmware === 'local' && (
            <p className="muted small">Yerel firmware: giriş pinleri sırayla çıkış pinlerine aktarılır.</p>
          )}
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
    default: {
      const view = viewOf(state.type);
      const controls = view?.controls?.filter((c) => !c.when || c.when(state)) ?? [];
      if (!controls.length) return null;
      return (
        <Live>
          <div className="controls">
            {controls.map((ctl, i) => (
              <ControlField key={i} ctl={ctl} s={state} id={id} send={send} onButton={onButton} />
            ))}
          </div>
        </Live>
      );
    }
  }
}

function ControlField({
  ctl,
  s,
  id,
  send,
  onButton,
}: {
  ctl: Control<unknown>;
  s: unknown;
  id: string;
  send(command: SimCommand): void;
  onButton(component: string, pressed: boolean): void;
}) {
  switch (ctl.kind) {
    case 'button':
      return (
        <button type="button" onClick={() => send({ type: 'device', component: id, action: ctl.action, value: ctl.value?.(s) })}>
          {typeof ctl.label === 'string' ? ctl.label : ctl.label(s)}
        </button>
      );
    case 'hold': {
      const held = ctl.held(s);
      return (
        <button type="button" className={held ? 'active' : ''} onClick={() => onButton(id, !held)}>
          {held ? `${ctl.label} (bırak)` : ctl.label}
        </button>
      );
    }
    case 'slider': {
      const v = ctl.value(s);
      const unit = typeof ctl.unit === 'function' ? ctl.unit(s) : ctl.unit;
      return (
        <label className="slider">
          <span>
            {ctl.label}: <span className="mono">{+v.toFixed(2)}</span>
            {unit ? ` ${unit}` : ''}
          </span>
          <input
            type="range"
            min={numOf(ctl.min, s)}
            max={numOf(ctl.max, s)}
            step={ctl.step}
            value={v}
            onChange={(e) => send({ type: 'device', component: id, action: ctl.action, value: Number(e.target.value) })}
          />
        </label>
      );
    }
  }
}

/** Bileşenin adlandırılmış canlı değerleri (trend ve görev senaryolarında kullanılan adlarla). */
function SignalTable({ state }: { state: ComponentState }) {
  if (state.type === 'plc' || state.type === 'esp32') return null;
  const entries = Object.entries(componentSignals(state));
  if (!entries.length) return null;
  return (
    <details className="signals" open={!!viewOf(state.type)}>
      <summary>Sinyaller</summary>
      <table className="terms">
        <tbody>
          {entries.map(([k, sig]) => (
            <tr key={k}>
              <td>{sig.label}</td>
              <td className="mono">
                {typeof sig.value === 'boolean' ? (
                  <Lamp on={sig.value} />
                ) : (
                  `${+sig.value.toFixed(2)}${sig.unit ? ` ${sig.unit}` : ''}`
                )}
              </td>
              <td className="mono muted small">.{k}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Arıza enjeksiyonu: düzenlemede başlangıç arızaları, simülasyonda anlık arızalar. */
function FaultSection({ c, schematic, mode, snapshot, send, dispatch }: Props & { c: ComponentInstance }) {
  const faults = faultsOf(c.type);
  if (!faults.length) return null;
  const edit = mode === 'edit';
  if (!edit && schematic.hideFaults) return null;
  const active = edit ? (c.faults ?? []) : (snapshot?.faults[c.id] ?? []);
  return (
    <details className="faults" open={active.length > 0}>
      <summary>
        Arıza {edit ? 'ayarla (simülasyon başında)' : 'enjeksiyonu'}
        {active.length > 0 && <span className="count">{active.length}</span>}
      </summary>
      {faults.map((f) => (
        <label key={f.key} className="check">
          <input
            type="checkbox"
            checked={active.includes(f.key)}
            onChange={(e) =>
              edit
                ? dispatch({
                    type: 'setFaults',
                    id: c.id,
                    faults: e.target.checked ? [...active, f.key] : active.filter((k) => k !== f.key),
                  })
                : send({ type: 'fault', component: c.id, fault: f.key, active: e.target.checked })
            }
          />
          {f.label}
        </label>
      ))}
    </details>
  );
}

export function signalText(s: Signal): string {
  switch (s.kind) {
    case 'V':
      return `${s.v.toFixed(2)} V`;
    case 'mA':
      return `${s.ma.toFixed(2)} mA`;
    case 'pulse':
      return `enkoder darbe ${Math.round(s.pos)}`;
    case 'drive':
      return `VFD ${s.hz.toFixed(1)} Hz`;
  }
}

function Lamp({ on, fault }: { on: boolean; fault?: boolean }) {
  return <span className={`lamp${fault ? ' fault' : on ? ' on' : ''}`} />;
}
