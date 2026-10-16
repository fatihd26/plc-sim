// Sahneler: trafik ışığı (yol, durma çizgisi, sinyal kafası ve araçlar).

import type { ReactNode } from 'react';
import { CROSSING, JUNCTION } from '../../sim/modules/traffic';
import { Lead, top } from './common';
import { defineView, type StateOf } from './types';

const ROAD = { x0: 10, len: 240, y: 98, h: 34 };
const roadX = (p: number) => ROAD.x0 + Math.max(0, Math.min(1, p)) * ROAD.len;

const LAMPS = [
  { key: 'red', x: 120 },
  { key: 'yellow', x: 150 },
  { key: 'green', x: 180 },
] as const;

export const trafficLightView = defineView<StateOf<'trafficLight'>>({
  type: 'trafficLight',
  geometry: {
    w: 260,
    h: 150,
    terminals: [top('L+', 20), top('M', 40), top('R', 120), top('Y', 150), top('G', 180)],
  },
  Body: ({ s }) => {
    const stopX = roadX(s?.stopAt ?? 0.58);
    const carLen = (s?.carLength ?? 0.08) * ROAD.len;
    return (
      <g className={`mech traffic${s?.conflict ? ' tripped' : ''}`}>
        <rect x={0} y={0} width={260} height={150} className="hit" />
        {s?.conflict && <rect x={1} y={1} width={258} height={148} rx={4} className="tl-alarm" />}
        {/* LED sürücü kartı */}
        <Lead x={20} y1={0} y2={12} />
        <Lead x={40} y1={0} y2={12} />
        <rect x={10} y={12} width={40} height={16} rx={2} className={s?.powered ? 'tl-card on' : 'tl-card'} />
        <text x={30} y={20} className="sym-text tiny">
          LED kart
        </text>
        {/* Sinyal kafası ve direk */}
        {LAMPS.map((l) => (
          <Lead key={l.x} x={l.x} y1={0} y2={22} />
        ))}
        <rect x={104} y={22} width={92} height={30} rx={6} className="tl-head" />
        {LAMPS.map((l) => (
          <circle key={l.key} cx={l.x} cy={37} r={10} className={`tl-lamp ${l.key}${s?.[l.key] ? ' on' : ''}`} />
        ))}
        <line x1={150} y1={52} x2={150} y2={ROAD.y} className="tl-pole" />
        {/* Yol, şerit çizgisi ve durma çizgisi */}
        <rect x={ROAD.x0} y={ROAD.y} width={ROAD.len} height={ROAD.h} className="road" />
        <line x1={ROAD.x0} y1={ROAD.y + ROAD.h / 2} x2={ROAD.x0 + ROAD.len} y2={ROAD.y + ROAD.h / 2} className="lane" />
        <line x1={stopX + 2} y1={ROAD.y + 2} x2={stopX + 2} y2={ROAD.y + ROAD.h - 2} className="stop-line" />
        {/* Araçlar (sağa doğru gider) */}
        {s?.cars.map((front, i) => {
          const x1 = roadX(front - (s.carLength ?? 0.08));
          const x2 = roadX(front);
          if (x2 - x1 < 1) return null;
          return (
            <g key={i} className={s.moving[i] ? 'car' : 'car stopped'}>
              <rect x={x1} y={ROAD.y + ROAD.h / 2 + 2} width={x2 - x1} height={12} rx={3} className="car-body" />
              {x2 - x1 > carLen * 0.6 && <rect x={x2 - 6} y={ROAD.y + ROAD.h / 2 + 4} width={4} height={8} rx={1} className="windshield" />}
            </g>
          );
        })}
        {s && (
          <text x={ROAD.x0} y={ROAD.y + ROAD.h + 10} className="sym-text small readout" style={{ textAnchor: 'start' }}>
            Geçen {s.passed} · Bekleyen {s.waiting}
          </text>
        )}
        {s?.conflict && (
          <text x={225} y={37} className="sym-text small fault-text">
            ÇATIŞMA
          </text>
        )}
      </g>
    );
  },
  click: { action: 'addCar' },
  controls: [{ kind: 'button', label: 'Araç ekle', action: 'addCar' }],
});

// --- Kavşak (üstten görünüş) ----------------------------------------------------------------
//
// Şerit konumları çekirdekteki JUNCTION oranlarıyla eşleşir: A yolu x 10..290 (y 132..168),
// B yolu y 30..250 (x 132..168). Yaya geçidi A yolunda x 100..120.

const JA = { x0: 10, len: 280, y0: 132, y1: 168 };
const JB = { y0: 30, len: 220, x0: 132, x1: 168 };
const ax = (p: number) => JA.x0 + Math.max(0, Math.min(1, p)) * JA.len;
const by = (p: number) => JB.y0 + Math.max(0, Math.min(1, p)) * JB.len;

/** Dikey üç lambalı sinyal kafası. */
function Head3({ x, y, h }: { x: number; y: number; h: { red: boolean; yellow: boolean; green: boolean } | undefined }) {
  return (
    <g>
      <rect x={x} y={y} width={18} height={44} rx={4} className="tl-head" />
      {(['red', 'yellow', 'green'] as const).map((k, i) => (
        <circle key={k} cx={x + 9} cy={y + 9 + i * 13} r={5} className={`tl-lamp ${k}${h?.[k] ? ' on' : ''}`} />
      ))}
    </g>
  );
}

const JTERMS = [
  ['L+', 20],
  ['M', 40],
  ['AR', 70],
  ['AY', 90],
  ['AG', 110],
  ['BR', 140],
  ['BY', 160],
  ['BG', 180],
  ['PR', 210],
  ['PG', 230],
  ['PB', 260],
] as const;

const Readout = ({ x = 182, y, children }: { x?: number; y: number; children: ReactNode }) => (
  <text x={x} y={y} className="sym-text small readout" style={{ textAnchor: 'start' }}>
    {children}
  </text>
);

export const trafficJunctionView = defineView<StateOf<'trafficJunction'>>({
  type: 'trafficJunction',
  geometry: { w: 300, h: 260, terminals: JTERMS.map(([n, x]) => top(n, x)) },
  Body: ({ s }) => {
    const carLen = s?.carLength ?? 0.08;
    return (
      <g className="mech traffic">
        <rect x={0} y={0} width={300} height={260} className="hit" />
        {(s?.conflict || s?.crash || s?.danger) && <rect x={1} y={1} width={298} height={258} rx={4} className="tl-alarm" />}
        {/* Sinyal kartı ve uç etiketleri */}
        {JTERMS.map(([n, x]) => (
          <g key={n}>
            <Lead x={x} y1={0} y2={8} />
            <text x={x} y={14} className="sym-text tiny">
              {n}
            </text>
          </g>
        ))}
        <rect x={6} y={8} width={288} height={12} rx={2} className={s?.powered ? 'tl-card frame-only on' : 'tl-card frame-only'} />
        {/* Yollar ve kavşak kutusu */}
        <rect x={JA.x0} y={JA.y0} width={JA.len} height={JA.y1 - JA.y0} className="road" />
        <rect x={JB.x0} y={JB.y0} width={JB.x1 - JB.x0} height={JB.len} className="road" />
        <rect x={JB.x0} y={JA.y0} width={JB.x1 - JB.x0} height={JA.y1 - JA.y0} className={s?.crash ? 'tl-box crash' : 'tl-box'} />
        {/* Yaya geçidi (zebra) ve durma çizgileri */}
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={100} y={JA.y0 + 3 + i * 8.5} width={20} height={4} className={s?.danger ? 'zebra danger' : 'zebra'} />
        ))}
        <line x1={ax(JUNCTION.a.stop) + 1} y1={JA.y0 + 2} x2={ax(JUNCTION.a.stop) + 1} y2={JA.y1 - 2} className="stop-line" />
        <line x1={JB.x0 + 2} y1={by(JUNCTION.b.stop) + 1} x2={JB.x1 - 2} y2={by(JUNCTION.b.stop) + 1} className="stop-line" />
        {/* Yön okları */}
        <path d={`M 22 ${JA.y0 + 18} h 14 m -5 -4 l 5 4 l -5 4`} className="lane-arrow" />
        <path d={`M ${JB.x0 + 18} 36 v 14 m -4 -5 l 4 5 l 4 -5`} className="lane-arrow" />
        {/* Sinyal kafaları: A (yolun altında), B (yolun sağında), yaya (geçidin yanında) */}
        <Head3 x={72} y={176} h={s?.a} />
        <text x={81} y={228} className="sym-text tiny">
          A
        </text>
        <Head3 x={174} y={82} h={s?.b} />
        <text x={183} y={76} className="sym-text tiny">
          B
        </text>
        <rect x={74} y={94} width={16} height={30} rx={4} className="tl-head" />
        <circle cx={82} cy={102} r={5} className={`tl-lamp red${s?.pedRed ? ' on' : ''}`} />
        <circle cx={82} cy={116} r={5} className={`tl-lamp green${s?.pedGreen ? ' on' : ''}`} />
        <text x={82} y={88} className="sym-text tiny">
          Yaya
        </text>
        <circle cx={60} cy={116} r={5} className={s?.button ? 'ped-button on' : 'ped-button'} />
        <text x={60} y={104} className="sym-text tiny">
          PB
        </text>
        {/* Araçlar */}
        {s?.a.cars.map((front, i) => {
          const x1 = ax(front - carLen);
          const x2 = ax(front);
          return x2 - x1 < 1 ? null : (
            <g key={`a${i}`} className={s.a.moving[i] ? 'car' : 'car stopped'}>
              <rect x={x1} y={143} width={x2 - x1} height={14} rx={3} className="car-body" />
              {x2 - x1 > 12 && <rect x={x2 - 6} y={145} width={4} height={10} rx={1} className="windshield" />}
            </g>
          );
        })}
        {s?.b.cars.map((front, i) => {
          const y1 = by(front - carLen);
          const y2 = by(front);
          return y2 - y1 < 1 ? null : (
            <g key={`b${i}`} className={s.b.moving[i] ? 'car' : 'car stopped'}>
              <rect x={143} y={y1} width={14} height={y2 - y1} rx={3} className="car-body" />
              {y2 - y1 > 12 && <rect x={145} y={y2 - 6} width={10} height={4} rx={1} className="windshield" />}
            </g>
          );
        })}
        {/* Yayalar: bekleyenler kaldırımda, geçenler zebrada */}
        {s &&
          Array.from({ length: Math.min(s.pedWaiting, 6) }, (_, i) => (
            <circle key={`w${i}`} cx={103 + (i % 3) * 7} cy={125 - Math.floor(i / 3) * 7} r={3} className="ped" />
          ))}
        {s?.walkers.map((w, i) => (
          <circle key={`p${i}`} cx={106 + (i % 2) * 8} cy={w < 0 ? 125 : JA.y0 - 4 + w * (JA.y1 - JA.y0 + 8)} r={3} className="ped walking" />
        ))}
        {/* Sayaçlar ve uyarılar */}
        {s && (
          <g>
            <Readout y={192}>A geçen {s.a.passed}</Readout>
            <Readout y={206}>B geçen {s.b.passed}</Readout>
            <Readout y={220}>Yaya geçen {s.pedPassed}</Readout>
          </g>
        )}
        {s?.conflict && (
          <text x={240} y={40} className="sym-text small fault-text">
            ÇATIŞMA
          </text>
        )}
        {s?.crash && (
          <text x={240} y={54} className="sym-text small fault-text">
            KAZA RİSKİ
          </text>
        )}
        {s?.danger && (
          <text x={240} y={68} className="sym-text small fault-text">
            YAYA TEHLİKEDE
          </text>
        )}
      </g>
    );
  },
  click: { action: 'pedestrian' },
  controls: [
    { kind: 'button', label: 'Yaya gelsin (butona basar)', action: 'pedestrian' },
    { kind: 'button', label: 'A yoluna araç', action: 'carA' },
    { kind: 'button', label: 'B yoluna araç', action: 'carB' },
  ],
});

// --- Butonlu yaya geçidi (üstten görünüş) ---------------------------------------------------
//
// Yol x 10..290: üst şerit (y 100..130) batıya, alt şerit (y 130..160) doğuya gider. Zebra
// x 140..160; kaldırımlar yolun üstünde ve altında. Konumlar çekirdekteki CROSSING ile eşleşir.

const PX = { x0: 10, len: 280, top: 100, mid: 130, bottom: 160 };
const eastX = (p: number) => PX.x0 + Math.max(0, Math.min(1, p)) * PX.len;
const westX = (p: number) => PX.x0 + PX.len - Math.max(0, Math.min(1, p)) * PX.len;

const PTERMS = [
  ['L+', 20],
  ['M', 40],
  ['R', 80],
  ['Y', 100],
  ['G', 120],
  ['PR', 170],
  ['PG', 190],
  ['W', 210],
  ['PB', 260],
] as const;

/** İki lambalı yaya ışığı. */
function PedHead({ x, y, red, green }: { x: number; y: number; red?: boolean; green?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={16} height={30} rx={4} className="tl-head" />
      <circle cx={x + 8} cy={y + 8} r={5} className={`tl-lamp red${red ? ' on' : ''}`} />
      <circle cx={x + 8} cy={y + 22} r={5} className={`tl-lamp green${green ? ' on' : ''}`} />
    </g>
  );
}

/** Buton kutusu: üstte BEKLEYİN lambası, altta buton. */
function ButtonBox({ x, y, wait, pressed }: { x: number; y: number; wait?: boolean; pressed?: boolean }) {
  return (
    <g>
      <rect x={x} y={y} width={26} height={26} rx={3} className="ped-box" />
      <rect x={x + 3} y={y + 3} width={20} height={7} rx={1} className={wait ? 'wait-lamp on' : 'wait-lamp'} />
      <circle cx={x + 13} cy={y + 18} r={4} className={pressed ? 'ped-button on' : 'ped-button'} />
    </g>
  );
}

export const pedCrossingView = defineView<StateOf<'pedCrossing'>>({
  type: 'pedCrossing',
  geometry: { w: 300, h: 240, terminals: PTERMS.map(([n, x]) => top(n, x)) },
  Body: ({ s }) => {
    const carLen = s?.carLength ?? 0.08;
    const lane = (l: NonNullable<typeof s>['east'], dir: 'e' | 'w', y: number) =>
      l.cars.map((front, i) => {
        const [x1, x2] = dir === 'e' ? [eastX(front - carLen), eastX(front)] : [westX(front), westX(front - carLen)];
        return x2 - x1 < 1 ? null : (
          <g key={`${dir}${i}`} className={l.moving[i] ? 'car' : 'car stopped'}>
            <rect x={x1} y={y} width={x2 - x1} height={14} rx={3} className="car-body" />
            {x2 - x1 > 12 && <rect x={dir === 'e' ? x2 - 6 : x1 + 2} y={y + 2} width={4} height={10} rx={1} className="windshield" />}
          </g>
        );
      });
    return (
      <g className="mech traffic">
        <rect x={0} y={0} width={300} height={240} className="hit" />
        {(s?.conflict || s?.danger) && <rect x={1} y={1} width={298} height={238} rx={4} className="tl-alarm" />}
        {PTERMS.map(([n, x]) => (
          <g key={n}>
            <Lead x={x} y1={0} y2={8} />
            <text x={x} y={14} className="sym-text tiny">
              {n}
            </text>
          </g>
        ))}
        <rect x={6} y={8} width={288} height={12} rx={2} className={s?.powered ? 'tl-card frame-only on' : 'tl-card frame-only'} />
        {/* Kaldırımlar, yol, şerit çizgisi, zebra, durma çizgileri */}
        <rect x={PX.x0} y={84} width={PX.len} height={16} className="sidewalk" />
        <rect x={PX.x0} y={PX.bottom} width={PX.len} height={16} className="sidewalk" />
        <rect x={PX.x0} y={PX.top} width={PX.len} height={PX.bottom - PX.top} className="road" />
        <line x1={PX.x0} y1={PX.mid} x2={PX.x0 + PX.len} y2={PX.mid} className="lane" />
        {Array.from({ length: 7 }, (_, i) => (
          <rect key={i} x={140} y={PX.top + 3 + i * 8.3} width={20} height={4} className={s?.danger ? 'zebra danger' : 'zebra'} />
        ))}
        <line x1={eastX(CROSSING.stop) + 1} y1={PX.mid + 2} x2={eastX(CROSSING.stop) + 1} y2={PX.bottom - 2} className="stop-line" />
        <line x1={westX(CROSSING.stop) - 1} y1={PX.top + 2} x2={westX(CROSSING.stop) - 1} y2={PX.mid - 2} className="stop-line" />
        <path d={`M 22 ${PX.mid + 8} h 14 m -5 -4 l 5 4 l -5 4`} className="lane-arrow" />
        <path d={`M 278 ${PX.mid - 8} h -14 m 5 -4 l -5 4 l 5 4`} className="lane-arrow" />
        {/* Araç ışıkları (iki yöne, aynı sinyal) */}
        <Head3 x={108} y={180} h={s} />
        <Head3 x={174} y={36} h={s} />
        {/* Yaya ışıkları ve buton kutuları (iki kaldırım) */}
        <PedHead x={120} y={50} red={s?.pedRed} green={s?.pedGreen} />
        <PedHead x={164} y={180} red={s?.pedRed} green={s?.pedGreen} />
        <ButtonBox x={86} y={54} wait={s?.wait} pressed={s?.button} />
        <ButtonBox x={188} y={182} wait={s?.wait} pressed={s?.button} />
        {/* Araçlar */}
        {s && lane(s.west, 'w', PX.top + 8)}
        {s && lane(s.east, 'e', PX.mid + 8)}
        {/* Yayalar: üst kaldırımdan aşağı, alt kaldırımdan yukarı */}
        {s &&
          s.pedWaiting.map((n, side) =>
            Array.from({ length: Math.min(n, 6) }, (_, i) => (
              <circle key={`w${side}${i}`} cx={143 + (i % 3) * 7} cy={side === 0 ? 92 - Math.floor(i / 3) * 6 : 168 + Math.floor(i / 3) * 6} r={3} className="ped" />
            )),
          )}
        {s?.walkers.map((p, i) => {
          const t = Math.max(0, p.w);
          const y = p.side === 0 ? 94 + t * 72 : 166 - t * 72;
          return <circle key={`p${i}`} cx={p.side === 0 ? 146 : 154} cy={p.w < 0 ? (p.side === 0 ? 92 : 168) : y} r={3} className="ped walking" />;
        })}
        {s && (
          <g>
            <Readout x={10} y={196}>Geçen araç {s.east.passed + s.west.passed}</Readout>
            <Readout x={10} y={210}>Geçen yaya {s.pedPassed}</Readout>
          </g>
        )}
        {s?.conflict && (
          <text x={250} y={40} className="sym-text small fault-text">
            ÇATIŞMA
          </text>
        )}
        {s?.danger && (
          <text x={250} y={54} className="sym-text small fault-text">
            YAYA TEHLİKEDE
          </text>
        )}
      </g>
    );
  },
  click: { action: 'pedestrian' },
  controls: [
    { kind: 'button', label: 'Yaya gelsin (butona basar)', action: 'pedestrian' },
    { kind: 'button', label: 'Araç ekle', action: 'car' },
  ],
});
