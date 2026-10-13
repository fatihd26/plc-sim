// Proses sembolleri: seviye kontrol tankı ve elektrikli fırın.

import { numParam, strParam } from '../../sim/catalog';
import { bottom, Coil, Lead, right, top } from './common';
import { defineView, type StateOf } from './types';

/** Vana sembolü (iki üçgen); açıklık 0..1 dolgu ile gösterilir. */
function Valve({ x, y, open, vertical }: { x: number; y: number; open: number; vertical?: boolean }) {
  const d = vertical ? `M ${x - 7} ${y - 8} L ${x + 7} ${y - 8} L ${x - 7} ${y + 8} L ${x + 7} ${y + 8} Z` : `M ${x - 8} ${y - 7} L ${x + 8} ${y + 7} L ${x + 8} ${y - 7} L ${x - 8} ${y + 7} Z`;
  return <path d={d} className="valve" style={{ fillOpacity: 0.15 + 0.85 * open }} />;
}

// --- Proses tankı ---------------------------------------------------------------------------

const TANK = { x0: 80, x1: 150, top: 40, bottom: 140 };

export const processTankView = defineView<StateOf<'processTank'>>({
  type: 'processTank',
  geometry: {
    w: 200,
    h: 180,
    terminals: [
      top('A1', 20),
      top('A2', 40),
      top('Y', 60),
      bottom('B1', 140, 180),
      bottom('B2', 160, 180),
      right('23', 50, 200),
      right('24', 70, 200),
      right('13', 110, 200),
      right('14', 130, 200),
    ],
  },
  Body: ({ inst, s }) => {
    const analog = strParam(inst, 'inlet') === 'analog';
    const level = s?.level ?? numParam(inst, 'initialPct') / 100;
    const h = TANK.bottom - TANK.top;
    const yAt = (f: number) => TANK.bottom - f * h;
    const lowAt = s?.lowAt ?? numParam(inst, 'lowPct') / 100;
    const highAt = s?.highAt ?? numParam(inst, 'highPct') / 100;
    const inflow = (s?.inlet ?? 0) > 0.01;
    return (
      <g className={`mech pump${s?.overflowing ? ' overflow' : ''}${s?.fault ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={200} height={180} className="hit" />
        {/* Giriş: selenoid bobini (A1-A2) veya oransal vana (Y) */}
        <Lead x={20} y1={0} y2={8} />
        <Lead x={40} y1={0} y2={8} />
        <Coil x={30} y={8} on={!analog && inflow} fault={!!s?.fault} />
        <Lead x={60} y1={0} y2={14} />
        <text x={60} y={20} className="sym-text tiny">
          {analog ? `${Math.round((s?.inlet ?? 0) * 100)}%` : 'Y'}
        </text>
        <path d="M 4 36 H 115 V 40" className="pipe" />
        <path d="M 4 36 H 115 V 40" className={inflow ? 'flow on' : 'flow'} />
        <line x1={30} y1={22} x2={30} y2={30} className="thin" />
        <Valve x={50} y={36} open={s?.inlet ?? 0} />
        {/* Tank ve sıvı */}
        <rect x={TANK.x0} y={TANK.top} width={TANK.x1 - TANK.x0} height={h} className="box tank" />
        {level > 0 && <rect x={TANK.x0 + 1} y={yAt(level)} width={TANK.x1 - TANK.x0 - 2} height={level * h - 1} className="water" />}
        <text x={115} y={52} className="sym-text tiny readout">
          {Math.round(level * 100)}%
        </text>
        {/* Çıkış vanası (B1-B2) ve tüketim */}
        <path d="M 115 140 V 160 H 196" className="pipe" />
        <path d="M 115 140 V 160 H 196" className={s && (s.outlet || s.demand > 0) && level > 0 ? 'flow on' : 'flow'} />
        <Valve x={135} y={160} open={s?.outlet ? 1 : 0} />
        <Lead x={140} y1={180} y2={176} />
        <Lead x={160} y1={180} y2={176} />
        <rect x={136} y={168} width={28} height={8} className={s?.outlet ? 'coil on' : 'coil'} />
        {/* Şamandıralar: üst 23-24, alt 13-14 */}
        {[
          { f: highAt, on: s?.high, y0: 50 },
          { f: lowAt, on: s?.low, y0: 110 },
        ].map(({ f, on, y0 }) => (
          <g key={y0}>
            <line x1={TANK.x0} y1={yAt(f)} x2={TANK.x1} y2={yAt(f)} strokeDasharray="2 3" className="thin level-mark" />
            <rect x={172} y={y0} width={14} height={20} rx={2} className={on ? 'sensor on' : 'sensor'} />
            <line x1={186} y1={y0} x2={200} y2={y0} />
            <line x1={186} y1={y0 + 20} x2={200} y2={y0 + 20} />
            <line x1={TANK.x1} y1={yAt(f)} x2={172} y2={y0 + 10} className="thin" />
          </g>
        ))}
      </g>
    );
  },
  controls: [{ kind: 'slider', label: 'Tüketim (bozucu etki)', action: 'demand', min: 0, max: 100, step: 5, unit: '%', value: (s) => s.demand * 100 }],
});

// --- Fırın ----------------------------------------------------------------------------------

export const furnaceView = defineView<StateOf<'furnace'>>({
  type: 'furnace',
  geometry: { w: 180, h: 130, terminals: [top('H1', 20), top('H2', 40), top('Y', 60), right('11', 50, 180), right('12', 70, 180)] },
  Body: ({ inst, s }) => {
    const temp = s?.temp ?? numParam(inst, 'ambientC');
    const glow = Math.max(0, Math.min(1, (temp - 40) / 400));
    return (
      <g className={`mech furnace${s?.fault ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={180} height={130} className="hit" />
        <Lead x={20} y1={0} y2={30} />
        <Lead x={40} y1={0} y2={30} />
        <Lead x={60} y1={0} y2={14} />
        <text x={60} y={20} className="sym-text tiny">
          Y
        </text>
        {/* Gövde ve iç hazne */}
        <rect x={10} y={30} width={140} height={90} rx={4} className="box" />
        <rect x={22} y={42} width={116} height={66} className="chamber" style={{ fillOpacity: glow }} />
        {/* Rezistans */}
        <path
          d="M 20 30 V 50 l 8 6 l -8 6 l 8 6 l -8 6 l 8 6 M 40 30 V 50 l 8 6 l -8 6 l 8 6 l -8 6 l 8 6"
          className={s && s.power > 0 ? 'heater on' : 'heater'}
        />
        <text x={88} y={78} className="sym-text readout">
          {Math.round(temp)} °C
        </text>
        <text x={88} y={94} className="sym-text tiny">
          güç {Math.round((s?.power ?? 0) * 100)}%
        </text>
        {/* Kapak */}
        <rect x={s?.doorOpen ? 152 : 138} y={42} width={6} height={66} className={s?.doorOpen ? 'door open' : 'door'} />
        {/* Emniyet termostatı 11-12 */}
        <g className={s?.tripped ? 'pole' : 'pole closed'}>
          <line x1={180} y1={50} x2={166} y2={50} />
          <line x1={166} y1={50} x2={166} y2={56} />
          <line x1={166} y1={64} x2={s?.tripped ? 174 : 166} y2={s?.tripped ? 58 : 56} className="blade" />
          <line x1={166} y1={64} x2={166} y2={70} />
          <line x1={166} y1={70} x2={180} y2={70} />
        </g>
        <text x={160} y={84} className="sym-text tiny">
          θ&gt;
        </text>
      </g>
    );
  },
  click: { action: 'door' },
  controls: [{ kind: 'button', label: (s) => (s.doorOpen ? 'Kapağı kapat' : 'Kapağı aç'), action: 'door' }],
});
