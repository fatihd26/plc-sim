// Sahneler: otopark bariyeri (üstten görünüş). Giriş şeridi (alt) soldan otoparka, çıkış şeridi
// (üst) otoparktan sola gider. Konumlar çekirdekteki PARKING oranlarıyla eşleşir.

import type { ReactNode } from 'react';
import { MAX_SPACES, PARKING as P } from '../../sim/modules/parking';
import { Lead, SensorBox, top } from './common';
import { defineView, type StateOf } from './types';

const IN = { x0: 10, len: 190, y0: 150, y1: 176 };
const OUT = { y0: 112, y1: 138 };
const inX = (p: number) => IN.x0 + Math.max(0, Math.min(1, p)) * IN.len;
const outX = (p: number) => IN.x0 + IN.len - Math.max(0, Math.min(1, p)) * IN.len;
const PIVOT = { x: inX(P.arm), y: 186 };
const ARM_LEN = 40;

const TERMS = [
  ['L+', 20],
  ['M', 40],
  ['UP', 70],
  ['DN', 90],
  ['FULL', 110],
  ['ENT', 140],
  ['TK', 160],
  ['SAFE', 180],
  ['LSO', 200],
  ['LSC', 220],
  ['EX', 260],
] as const;

const Readout = ({ y, children }: { y: number; children: ReactNode }) => (
  <text x={10} y={y} className="sym-text small readout" style={{ textAnchor: 'start' }}>
    {children}
  </text>
);

const Alert = ({ y, children }: { y: number; children: ReactNode }) => (
  <text x={150} y={y} className="sym-text small fault-text">
    {children}
  </text>
);

/** Üstten görünüşte araç (yatay). */
const Car = ({ x1, x2, y, moving, facing }: { x1: number; x2: number; y: number; moving: boolean; facing: 'e' | 'w' }) =>
  x2 - x1 < 1 ? null : (
    <g className={moving ? 'car' : 'car stopped'}>
      <rect x={x1} y={y} width={x2 - x1} height={12} rx={3} className="car-body" />
      {x2 - x1 > 10 && <rect x={facing === 'e' ? x2 - 5 : x1 + 1} y={y + 2} width={4} height={8} rx={1} className="windshield" />}
    </g>
  );

export const parkingBarrierView = defineView<StateOf<'parkingBarrier'>>({
  type: 'parkingBarrier',
  geometry: { w: 300, h: 240, terminals: TERMS.map(([n, x]) => top(n, x)) },
  Body: ({ s }) => {
    const capacity = Math.min(s?.capacity ?? 4, MAX_SPACES);
    const inLot = s?.inLot ?? 0;
    return (
      <g className="mech traffic">
        <rect x={0} y={0} width={300} height={240} className="hit" />
        {s?.hitting && <rect x={1} y={1} width={298} height={238} rx={4} className="tl-alarm" />}
        {TERMS.map(([n, x]) => (
          <g key={n}>
            <Lead x={x} y1={0} y2={8} />
            <text x={x} y={14} className="sym-text tiny">
              {n}
            </text>
          </g>
        ))}
        <rect x={6} y={8} width={288} height={12} rx={2} className={s?.powered ? 'tl-card frame-only on' : 'tl-card frame-only'} />
        {/* Otopark alanı ve park yerleri */}
        <rect x={204} y={36} width={88} height={196} rx={3} className="lot" />
        {Array.from({ length: capacity }, (_, i) => {
          const x = i % 2 === 0 ? 210 : 252;
          const y = 44 + Math.floor(i / 2) * 26;
          return (
            <g key={i}>
              <rect x={x} y={y} width={34} height={20} className="space" />
              {i < inLot && <Car x1={x + 4} x2={x + 30} y={y + 4} moving={false} facing="e" />}
            </g>
          );
        })}
        {inLot > capacity && (
          <text x={248} y={222} className="sym-text small fault-text">
            +{inLot - capacity} yer arıyor
          </text>
        )}
        {/* Şeritler */}
        <rect x={IN.x0} y={OUT.y0} width={IN.len + 4} height={OUT.y1 - OUT.y0} className="road" />
        <rect x={IN.x0} y={IN.y0} width={IN.len + 4} height={IN.y1 - IN.y0} className="road" />
        <path d={`M 22 ${IN.y0 + 13} h 14 m -5 -4 l 5 4 l -5 4`} className="lane-arrow" />
        <path d={`M 36 ${OUT.y0 + 13} h -14 m 5 -4 l -5 4 l 5 4`} className="lane-arrow" />
        {/* Loop dedektörleri (giriş: ENT, çıkış: EX) */}
        <rect x={inX(P.loopFrom)} y={IN.y0 + 2} width={inX(P.loopTo) - inX(P.loopFrom)} height={IN.y1 - IN.y0 - 4} className={s?.loop ? 'loop on' : 'loop'} />
        <rect x={outX(P.exitTo)} y={OUT.y0 + 2} width={outX(P.exitFrom) - outX(P.exitTo)} height={OUT.y1 - OUT.y0 - 4} className={s?.exitLoop ? 'loop on' : 'loop'} />
        {/* Kol altı fotoseli */}
        <line x1={inX(P.safeTo) - 1} y1={IN.y0} x2={inX(P.safeTo) - 1} y2={IN.y1} className={s?.under ? 'beam blocked' : 'beam'} />
        {/* Araçlar */}
        {s?.entry.map((front, i) => (
          <Car key={`e${i}`} x1={inX(front - P.car)} x2={inX(front)} y={IN.y0 + 7} moving={s.entryMoving[i]!} facing="e" />
        ))}
        {s?.exit.map((front, i) => <Car key={`x${i}`} x1={outX(front)} x2={outX(front - P.car)} y={OUT.y0 + 7} moving facing="w" />)}
        {/* Bariyer: kapalıyken şeridin üstünde, açılırken sola döner (kırmızı-beyaz kol) */}
        <g transform={`rotate(${-(s?.arm ?? 0) * 90} ${PIVOT.x} ${PIVOT.y})`}>
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y - ARM_LEN} className="arm-base" />
          <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x} y2={PIVOT.y - ARM_LEN} className={s?.hitting ? 'arm hit' : 'arm'} />
        </g>
        <rect x={PIVOT.x - 6} y={PIVOT.y - 4} width={12} height={12} rx={2} className="cabinet" />
        <SensorBox x={PIVOT.x + 8} y={PIVOT.y - 3} w={6} h={5} on={!!s && s.arm >= 0.98} />
        <SensorBox x={PIVOT.x + 8} y={PIVOT.y + 3} w={6} h={5} on={!!s && s.arm <= 0.02} />
        <text x={PIVOT.x + 30} y={PIVOT.y + 2} className="sym-text tiny">
          LSO/LSC
        </text>
        {/* Bilet makinesi ve DOLU levhası */}
        <rect x={inX(P.loopFrom) - 4} y={IN.y1 + 6} width={16} height={18} rx={2} className="ped-box" />
        <circle cx={inX(P.loopFrom) + 4} cy={IN.y1 + 17} r={4} className={s?.ticket ? 'ped-button on' : 'ped-button'} />
        <text x={inX(P.loopFrom) + 4} y={IN.y1 + 32} className="sym-text tiny">
          bilet
        </text>
        <rect x={12} y={IN.y1 + 8} width={40} height={16} rx={2} className={s?.full ? 'full-sign on' : 'full-sign'} />
        <text x={32} y={IN.y1 + 16} className={s?.full ? 'sym-text small full-text on' : 'sym-text small full-text'}>
          DOLU
        </text>
        {/* Sayaçlar ve uyarılar */}
        {s && (
          <g>
            <Readout y={40}>
              Otoparkta {s.inLot} / {s.capacity}
            </Readout>
            <Readout y={54}>Çıkan {s.left}</Readout>
            <Readout y={68}>DOLU görüp dönen {s.turnedAway}</Readout>
          </g>
        )}
        {!!s?.hits && <Alert y={84}>KOL ARACA İNDİ ({s.hits})</Alert>}
        {!!s?.overflows && <Alert y={70}>TAŞMA ({s.overflows})</Alert>}
      </g>
    );
  },
  click: { action: 'car' },
  controls: [
    { kind: 'button', label: 'Araç gelsin (DOLU olsa da)', action: 'car' },
    { kind: 'button', label: 'Bilet butonuna bas', action: 'ticket' },
  ],
});
