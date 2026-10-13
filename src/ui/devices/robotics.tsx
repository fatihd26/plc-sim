// Robotik ve konumlama sembolleri: lineer eksen, pick & place portalı, robot hücresi (üstten
// görünüş), asansör ve garaj kapısı.

import { numParam } from '../../sim/catalog';
import { bottom, Lead, motorClass, right, Rotor, SensorBox, top } from './common';
import { defineView, type StateOf } from './types';

/** Küçük 3~ motor (üstten U-V-W). */
function SmallMotor({ cx, cy, s }: { cx: number; cy: number; s: { powered: boolean; speed: number; angleDeg: number } | undefined }) {
  return (
    <g className={motorClass(s)}>
      <path d={`M 20 0 V ${cy - 10} M 40 0 V ${cy - 18} M 60 0 V ${cy - 10}`} />
      <circle cx={cx} cy={cy} r={18} className="box" />
      <Rotor cx={cx} cy={cy} r={16} angle={s?.angleDeg ?? 0} />
      <text x={cx} y={cy + 2} className="sym-text tiny">
        M 3~
      </text>
    </g>
  );
}

// --- Lineer eksen ---------------------------------------------------------------------------

const AX = { x0: 90, len: 190, y: 58 };

export const linearAxisView = defineView<StateOf<'linearAxis'>>({
  type: 'linearAxis',
  geometry: {
    w: 300,
    h: 100,
    terminals: [
      top('U', 20),
      top('V', 40),
      top('W', 60),
      top('L+', 120),
      top('M', 140),
      bottom('A', 20, 100),
      bottom('B', 40, 100),
      bottom('LSN', 100, 100),
      bottom('REF', 140, 100),
      bottom('LSP', 280, 100),
    ],
  },
  Body: ({ inst, s }) => {
    const length = s?.length ?? numParam(inst, 'lengthMm');
    const x = s?.x ?? numParam(inst, 'startMm');
    const refMm = s?.ref ?? numParam(inst, 'refMm');
    const px = (mm: number) => AX.x0 + (Math.max(0, Math.min(length, mm)) / length) * AX.len;
    return (
      <g className={`mech axis${s?.crashed ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={300} height={100} className="hit" />
        <SmallMotor cx={40} cy={44} s={s} />
        <Lead x={120} y1={0} y2={14} />
        <Lead x={140} y1={0} y2={14} />
        <text x={130} y={20} className="sym-text tiny">
          24V
        </text>
        {/* Vidalı mil ve ray */}
        <line x1={58} y1={44} x2={AX.x0} y2={44} strokeDasharray="3 2" className="thin" />
        <rect x={AX.x0 - 4} y={AX.y - 8} width={AX.len + 8} height={6} className="box" />
        <line x1={AX.x0} y1={44} x2={AX.x0 + AX.len} y2={44} className="screw" />
        {/* Taşıyıcı */}
        <rect x={px(x) - 12} y={30} width={24} height={20} rx={2} className="carriage" />
        {/* Sensörler: LSN, REF, LSP */}
        {[
          { mm: 10, t: 100, on: x <= 10, label: 'LSN' },
          { mm: refMm, t: 140, on: Math.abs(x - refMm) <= 3, label: 'REF' },
          { mm: length - 10, t: 280, on: x >= length - 10, label: 'LSP' },
        ].map((sn) => (
          <g key={sn.label}>
            <SensorBox x={px(sn.mm) - 5} y={60} w={10} h={8} on={!!s && sn.on} />
            <path d={`M ${px(sn.mm)} 68 V 84 H ${sn.t} V 100`} className="thin" />
          </g>
        ))}
        {/* Enkoder (motor arkasında) */}
        <rect x={12} y={66} width={36} height={14} rx={2} className="box" />
        <text x={30} y={74} className="sym-text tiny">
          ENC
        </text>
        <path d="M 20 80 V 100 M 40 80 V 100" />
        <text x={290} y={22} className="sym-text tiny readout" textAnchor="end">
          {Math.round(x)} mm
        </text>
      </g>
    );
  },
});

// --- Pick & place ---------------------------------------------------------------------------

export const pickPlaceView = defineView<StateOf<'pickPlace'>>({
  type: 'pickPlace',
  geometry: {
    w: 280,
    h: 200,
    terminals: [
      top('YX', 20),
      top('YZ', 40),
      top('YG', 60),
      top('L+', 100),
      top('M', 120),
      ...['X0', 'X1', 'Z0', 'Z1', 'GP', 'PS'].map((n, i) => bottom(n, 20 + i * 20, 200)),
    ],
  },
  Body: ({ s }) => {
    const cx = 70 + (s?.x ?? 0) * 150;
    const zLen = 20 + (s?.z ?? 0) * 70;
    const jaw = 4 + (1 - (s?.grip ?? 0)) * 6;
    const gy = 54 + zLen;
    return (
      <g className={`mech pick${s?.fault ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={280} height={200} className="hit" />
        {/* Bobinler */}
        {[
          { x: 20, on: s?.coils.x },
          { x: 40, on: s?.coils.z },
          { x: 60, on: s?.coils.g },
        ].map((c) => (
          <g key={c.x}>
            <Lead x={c.x} y1={0} y2={10} />
            <rect x={c.x - 6} y={10} width={12} height={14} className={c.on ? 'coil on' : 'coil'} />
          </g>
        ))}
        <Lead x={100} y1={0} y2={14} />
        <Lead x={120} y1={0} y2={14} />
        {/* Portal */}
        <rect x={50} y={36} width={210} height={10} className="box" />
        <line x1={56} y1={46} x2={56} y2={170} className="thin" />
        <line x1={254} y1={46} x2={254} y2={170} className="thin" />
        <rect x={cx - 12} y={30} width={24} height={22} rx={2} className="carriage" />
        <rect x={cx - 3} y={52} width={6} height={zLen} className="rod" />
        <path d={`M ${cx - jaw - 3} ${gy} v 12 M ${cx + jaw + 3} ${gy} v 12 M ${cx - jaw - 3} ${gy} h ${2 * jaw + 6}`} className="gripper" />
        {s?.holding && <rect x={cx - 7} y={gy + 2} width={14} height={12} className="part" />}
        {/* İstasyonlar */}
        <rect x={56} y={160} width={28} height={10} className="box" />
        {s?.partAtPick && <rect x={63} y={146} width={14} height={14} className="part" />}
        <path d="M 202 170 V 150 M 238 170 V 150 M 202 170 H 238" className="box-outline" />
        <text x={220} y={182} className="sym-text tiny readout">
          {s ? `${s.placed} parça` : 'yerleştirme'}
        </text>
        <text x={70} y={182} className="sym-text tiny">
          alma
        </text>
        {['X0', 'X1', 'Z0', 'Z1', 'GP', 'PS'].map((n, i) => (
          <Lead key={n} x={20 + i * 20} y1={190} y2={200} />
        ))}
      </g>
    );
  },
  controls: [{ kind: 'button', label: 'Parça koy', action: 'feed', when: (s) => !s.partAtPick }],
});

// --- Robot hücresi (üstten görünüş) ---------------------------------------------------------

const ROBOT_IO = ['START', 'P0', 'P1', 'RESET'];
const ROBOT_OUT = ['READY', 'BUSY', 'DONE', 'FAULT'];
const RAD = Math.PI / 180;

export const robotArmView = defineView<StateOf<'robotArm'>>({
  type: 'robotArm',
  geometry: {
    w: 260,
    h: 210,
    terminals: [
      top('L+', 20),
      top('M', 40),
      ...ROBOT_IO.map((n, i) => top(n, 100 + i * 20)),
      ...ROBOT_OUT.map((n, i) => bottom(n, 100 + i * 20, 210)),
    ],
  },
  Body: ({ s }) => {
    const [base, sh, el] = s?.joints ?? [0, 60, -100];
    const cx = 130;
    const cy = 115;
    // Eklem açılarından yatay erişim (çizim için): r = L1·cos(omuz) + L2·cos(omuz + dirsek)
    const r = 0.75 * (50 * Math.cos(sh * RAD) + 50 * Math.cos((sh + el) * RAD));
    const elbowR = 0.75 * 50 * Math.cos(sh * RAD);
    const at = (rad: number, deg: number) => ({ x: cx + rad * Math.sin(deg * RAD), y: cy - rad * Math.cos(deg * RAD) });
    const elbow = at(elbowR, base);
    const tool = at(r, base);
    const station = (deg: number) => at(72, deg);
    const st = { A: station(-70), B: station(40), C: station(80) };
    return (
      <g className={`mech robot${s?.fault ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={260} height={210} className="hit" />
        <Lead x={20} y1={0} y2={14} />
        <Lead x={40} y1={0} y2={14} />
        {ROBOT_IO.map((n, i) => (
          <Lead key={n} x={100 + i * 20} y1={0} y2={14} />
        ))}
        <rect x={6} y={14} width={248} height={182} rx={4} className="frame" />
        {/* İstasyonlar */}
        {(['A', 'B', 'C'] as const).map((k) => (
          <g key={k}>
            <circle cx={st[k].x} cy={st[k].y} r={11} className="station" />
            <text x={st[k].x} y={st[k].y + 20} className="sym-text tiny">
              {k}
              {s && k !== 'A' ? ` (${k === 'B' ? s.countB : s.countC})` : ''}
            </text>
          </g>
        ))}
        {s?.partA && <rect x={st.A.x - 5} y={st.A.y - 5} width={10} height={10} className="part" />}
        {/* Kol */}
        <circle cx={cx} cy={cy} r={14} className="box" />
        <line x1={cx} y1={cy} x2={elbow.x} y2={elbow.y} className="boom" />
        <line x1={elbow.x} y1={elbow.y} x2={tool.x} y2={tool.y} className="boom" />
        <circle cx={elbow.x} cy={elbow.y} r={4} className="hub" />
        <circle cx={tool.x} cy={tool.y} r={6} className={s?.gripping ? 'gripper closed' : 'gripper'} />
        {s?.gripping && <rect x={tool.x - 4} y={tool.y - 4} width={8} height={8} className="part" />}
        {/* Durum LED'leri */}
        {ROBOT_OUT.map((n, i) => {
          const on = s ? (n === 'READY' ? s.ready : n === 'BUSY' ? s.busy : n === 'DONE' ? s.done : !!s.fault) : false;
          return (
            <g key={n}>
              <circle cx={100 + i * 20} cy={186} r={4} className={n === 'FAULT' && on ? 'led fault' : on ? 'led on' : 'led'} />
              <Lead x={100 + i * 20} y1={190} y2={210} />
            </g>
          );
        })}
        <text x={20} y={34} className="sym-text tiny" textAnchor="start">
          {s ? (s.fault ? `HATA: ${s.fault}` : s.busy ? `program ${s.program}` : s.done ? 'bitti' : 'hazır') : 'robot'}
        </text>
      </g>
    );
  },
  controls: [{ kind: 'button', label: "A'ya parça koy", action: 'feed', when: (s) => !s.partA }],
});

// --- Asansör --------------------------------------------------------------------------------

const floorY = (pos: number) => 200 - pos * 70;

export const elevatorView = defineView<StateOf<'elevator'>>({
  type: 'elevator',
  geometry: {
    w: 170,
    h: 250,
    terminals: [top('U', 20), top('V', 40), top('W', 60), top('L+', 100), top('M', 120), right('F3', 60, 170), right('F2', 130, 170), right('F1', 200, 170)],
  },
  Body: ({ inst, s }) => {
    const pos = s?.pos ?? numParam(inst, 'startFloor') - 1;
    return (
      <g className={`mech elevator${s?.bumped ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={170} height={250} className="hit" />
        <SmallMotor cx={40} cy={36} s={s} />
        <Lead x={100} y1={0} y2={14} />
        <Lead x={120} y1={0} y2={14} />
        {/* Kuyu ve katlar */}
        <rect x={70} y={24} width={60} height={220} className="box shaft" />
        {[0, 1, 2].map((f) => (
          <g key={f}>
            <line x1={70} y1={floorY(f) + 22} x2={130} y2={floorY(f) + 22} className="thin" />
            <text x={62} y={floorY(f) + 4} className="sym-text tiny">
              {f + 1}
            </text>
            <SensorBox x={132} y={floorY(f) - 4} w={10} h={8} on={!!s && Math.abs(pos - f) <= 0.04} />
            <line x1={142} y1={floorY(f)} x2={170} y2={floorY(f)} />
          </g>
        ))}
        {/* Halat ve kabin */}
        <line x1={100} y1={24} x2={100} y2={floorY(pos) - 18} className="thin" />
        <rect x={78} y={floorY(pos) - 18} width={44} height={40} rx={2} className="cabin" />
        <line x1={100} y1={floorY(pos) - 14} x2={100} y2={floorY(pos) + 18} className="thin" />
      </g>
    );
  },
});

// --- Garaj kapısı ---------------------------------------------------------------------------

export const garageDoorView = defineView<StateOf<'garageDoor'>>({
  type: 'garageDoor',
  geometry: {
    w: 200,
    h: 170,
    terminals: [top('U', 20), top('V', 40), top('W', 60), top('L+', 100), top('M', 120), right('LSO', 40, 200), right('LSC', 120, 200), right('PH', 150, 200)],
  },
  Body: ({ s }) => {
    const pos = s?.pos ?? 0;
    const top0 = 40;
    const h = 110;
    const doorH = h * (1 - pos);
    return (
      <g className={`mech door${s && s.hits > 0 ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={200} height={170} className="hit" />
        <SmallMotor cx={40} cy={30} s={s} />
        <Lead x={100} y1={0} y2={14} />
        <Lead x={120} y1={0} y2={14} />
        {/* Kasa ve kapı panelleri */}
        <path d={`M 66 ${top0 + h} V ${top0} H 174 V ${top0 + h}`} className="box-outline" />
        {Array.from({ length: 5 }, (_, i) => {
          const y = top0 + i * 22;
          if (y + 22 > top0 + doorH + 0.5) return null;
          return <rect key={i} x={70} y={top0 + h - doorH + i * 22} width={100} height={21} className="panel" />;
        })}
        <rect x={70} y={top0 + h - doorH} width={100} height={doorH} className="panel-shade" />
        <line x1={60} y1={top0 + h} x2={180} y2={top0 + h} className="ground" />
        {/* Sınır sensörleri ve fotosel */}
        <SensorBox x={176} y={36} w={10} h={8} on={!!s && pos >= 0.98} />
        <SensorBox x={176} y={116} w={10} h={8} on={!!s && pos <= 0.02} />
        <path d="M 186 40 H 200 M 186 120 H 200" />
        <line x1={70} y1={142} x2={170} y2={142} className={s?.obstacle ? 'beam blocked' : 'beam'} />
        <path d="M 170 142 H 186 V 150 H 200" className="thin" />
        {s?.obstacle && <rect x={104} y={128} width={30} height={22} rx={3} className="obstacle" />}
      </g>
    );
  },
  click: { action: 'obstacle' },
  controls: [{ kind: 'button', label: (s) => (s.obstacle ? 'Engeli kaldır' : 'Kapı altına engel koy'), action: 'obstacle' }],
});
