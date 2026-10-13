// Cihaz çizimlerinin ortak parçaları: dönen rotor, motor sembolü, sensör kutusu, PNP sensör
// uçları, bobin ve terminal yardımcıları.

import type { TerminalGeo } from '../editor/geometry';

export const top = (name: string, x: number): TerminalGeo => ({ name, x, y: 0, dir: 'up' });
export const bottom = (name: string, x: number, h: number): TerminalGeo => ({ name, x, y: h, dir: 'down' });
export const left = (name: string, y: number): TerminalGeo => ({ name, x: 0, y, dir: 'left' });
export const right = (name: string, y: number, w: number): TerminalGeo => ({ name, x: w, y, dir: 'right' });

/** Dönen rotor işaretleri (motor sembolündeki gibi). */
export function Rotor({ cx, cy, r, angle }: { cx: number; cy: number; r: number; angle: number }) {
  return (
    <g transform={`rotate(${angle} ${cx} ${cy})`} className="rotor">
      {[0, 120, 240].map((a) => (
        <path key={a} d={`M ${cx} ${cy - r} l -3 4 h 6 Z`} transform={`rotate(${a} ${cx} ${cy})`} />
      ))}
    </g>
  );
}

export const motorClass = (s: { powered: boolean; speed: number } | undefined) =>
  s?.powered ? 'motor powered' : s && s.speed !== 0 ? 'motor coasting' : 'motor';

/** U-V-W uçlu küçük motor sembolü (merkez cx, cy). Uçlar üstten girer. */
export function Motor3({
  xs,
  cx,
  cy,
  r = 22,
  s,
  label = 'M 3~',
}: {
  xs: readonly [number, number, number];
  cx: number;
  cy: number;
  r?: number;
  s: { powered: boolean; speed: number; angleDeg: number } | undefined;
  label?: string;
}) {
  return (
    <g className={motorClass(s)}>
      {xs.map((x, i) => (
        <line key={x} x1={x} y1={0} x2={x} y2={cy - r + (i === 1 ? 0 : 8)} />
      ))}
      <circle cx={cx} cy={cy} r={r} className="box" />
      <Rotor cx={cx} cy={cy} r={r - 2} angle={s?.angleDeg ?? 0} />
      <text x={cx} y={cy + 2} className="sym-text small">
        {label}
      </text>
    </g>
  );
}

/** Sensör gövdesi (algılayınca yanar). */
export function SensorBox({ x, y, w = 20, h = 12, on, fault }: { x: number; y: number; w?: number; h?: number; on?: boolean; fault?: boolean }) {
  return <rect x={x} y={y} width={w} height={h} rx={2} className={fault ? 'sensor fault' : on ? 'sensor on' : 'sensor'} />;
}

/** Valf/ısıtıcı bobini (A1-A2 dikey). */
export function Coil({ x, y, on, fault, ac }: { x: number; y: number; on?: boolean; fault?: boolean; ac?: boolean }) {
  return (
    <g>
      <rect x={x - 9} y={y} width={18} height={14} className={on ? 'coil on' : fault ? 'coil fault' : 'coil'} />
      {ac && (
        <text x={x} y={y + 9} className="sym-text tiny">
          ~
        </text>
      )}
    </g>
  );
}

/** Dikey bağlantı çizgisi (terminalden gövdeye). */
export const Lead = ({ x, y1, y2 }: { x: number; y1: number; y2: number }) => <line x1={x} y1={y1} x2={x} y2={y2} />;

export const pct = (v: number) => `${Math.round(v)}%`;
