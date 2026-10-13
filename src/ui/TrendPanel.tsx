// Trend (osiloskop) paneli: seçilen sinyaller ortak bir zaman ekseninde, her biri kendi şeridinde
// (farklı birimler tek eksene konmaz). Boolean sinyaller lojik analizör gibi 0/1 basamak çizilir.
// Örnekler snapshot'lardan alınır; son 60 s tutulur. Üzerine gelince tüm şeritlerde o anın
// değeri gösterilir.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { allSignals, type NamedSignal } from '../sim/signals';
import type { Schematic } from '../sim/schematic';
import type { SimSnapshot } from '../sim/simulation';

const MAX_SERIES = 4;
const KEEP_MS = 60_000;
const MIN_STEP_MS = 20;
const WINDOWS = [5_000, 10_000, 30_000, 60_000];

interface Sample {
  t: number;
  v: (number | null)[];
}

interface Props {
  schematic: Schematic;
  snapshot: SimSnapshot | null;
  /** Seçili sinyaller (proje bazında App tutar; sekme değişince kaybolmasın). */
  selected: string[];
  onSelected(keys: string[]): void;
}

const LANE_NUM = 64;
const LANE_BOOL = 30;
const LABEL_W = 150;
const PAD_R = 12;
const AXIS_H = 20;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const fmt = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function TrendPanel({ schematic, snapshot, selected, onSelected }: Props) {
  const signals = useMemo(() => (snapshot ? allSignals(schematic, snapshot) : []), [schematic, snapshot]);
  const byKey = useMemo(() => new Map(signals.map((s) => [s.key, s])), [signals]);
  const buf = useRef<Sample[]>([]);
  const lastT = useRef(-1);
  const [windowMs, setWindowMs] = useState(10_000);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const [wrapRef, width] = useWidth<HTMLDivElement>();

  // Seçim değişince veya simülasyon baştan başlayınca tampon sıfırlanır.
  const selKey = selected.join('|');
  useEffect(() => {
    buf.current = [];
    lastT.current = -1;
  }, [selKey, schematic]);

  if (snapshot) {
    const t = snapshot.timeMs;
    if (t < lastT.current) buf.current = [];
    if (t - lastT.current >= MIN_STEP_MS || lastT.current < 0) {
      lastT.current = t;
      buf.current.push({
        t,
        v: selected.map((k) => {
          const s = byKey.get(k);
          return s === undefined ? null : typeof s.value === 'boolean' ? (s.value ? 1 : 0) : s.value;
        }),
      });
      const cut = t - KEEP_MS;
      while (buf.current.length && buf.current[0]!.t < cut) buf.current.shift();
    }
  }

  const add = (key: string) => {
    if (!key || selected.includes(key) || selected.length >= MAX_SERIES) return;
    onSelected([...selected, key]);
  };
  const remove = (key: string) => onSelected(selected.filter((k) => k !== key));

  if (!snapshot) return <p className="dock-note">Trend yalnız simülasyon modunda çalışır.</p>;

  const now = snapshot.timeMs;
  const t0 = now - windowMs;
  const data = buf.current.filter((s) => s.t >= t0 - MIN_STEP_MS);
  const plotW = Math.max(120, width - LABEL_W - PAD_R);
  const xOf = (t: number) => LABEL_W + ((t - t0) / windowMs) * plotW;
  const lanes = selected.map((key, i) => {
    const info = byKey.get(key);
    const bool = typeof info?.value === 'boolean';
    return { key, i, info, bool, h: bool ? LANE_BOOL : LANE_NUM };
  });
  let y = 0;
  const placed = lanes.map((l) => {
    const top = y;
    y += l.h + 8;
    return { ...l, top };
  });
  const height = y + AXIS_H;
  const hoverSample =
    hoverT === null ? null : data.reduce<Sample | null>((best, s) => (!best || Math.abs(s.t - hoverT) < Math.abs(best.t - hoverT) ? s : best), null);

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < LABEL_W) return setHoverT(null);
    setHoverT(t0 + ((x - LABEL_W) / plotW) * windowMs);
  };

  const ticks: number[] = [];
  const step = windowMs <= 10_000 ? 1000 : windowMs <= 30_000 ? 5000 : 10_000;
  for (let t = Math.ceil(t0 / step) * step; t <= now; t += step) ticks.push(t);

  return (
    <div className="trend">
      <div className="trend-bar">
        <SignalPicker signals={signals} selected={selected} disabled={selected.length >= MAX_SERIES} onPick={add} />
        <span className="muted small">
          {selected.length}/{MAX_SERIES} sinyal
        </span>
        <span className="seg" role="group" aria-label="Zaman penceresi">
          {WINDOWS.map((w) => (
            <button key={w} type="button" className={w === windowMs ? 'active' : ''} onClick={() => setWindowMs(w)}>
              {w / 1000} s
            </button>
          ))}
        </span>
      </div>
      <div ref={wrapRef} className="trend-plot">
        {selected.length === 0 ? (
          <p className="dock-note">
            Bir sinyal seçin (ör. tank seviyesi, PLC %IW0, motor hızı). En fazla {MAX_SERIES} sinyal, her biri kendi
            şeridinde çizilir.
          </p>
        ) : (
          <svg width={width} height={height} onPointerMove={onMove} onPointerLeave={() => setHoverT(null)} role="img" aria-label="Trend grafiği">
            {placed.map((l) => {
              const vals = data.map((s) => s.v[l.i]).filter((v): v is number => v !== null && v !== undefined);
              let lo = l.bool ? 0 : Math.min(...vals);
              let hi = l.bool ? 1 : Math.max(...vals);
              if (!vals.length) [lo, hi] = [0, 1];
              if (hi - lo < 1e-9) {
                lo -= 1;
                hi += 1;
              }
              const pad = l.bool ? 0 : (hi - lo) * 0.1;
              const yOf = (v: number) => l.top + 4 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (l.h - 8);
              let d = '';
              let prev: number | null = null;
              for (const s of data) {
                const v = s.v[l.i];
                if (v === null || v === undefined) {
                  prev = null;
                  continue;
                }
                const x = Math.max(LABEL_W, xOf(s.t));
                if (prev === null) d += `M ${x} ${yOf(v)} `;
                else if (l.bool) d += `H ${x} V ${yOf(v)} `;
                else d += `L ${x} ${yOf(v)} `;
                prev = v;
              }
              const cur = l.info?.value;
              return (
                <g key={l.key} className={`lane s${l.i + 1}`}>
                  <rect x={LABEL_W} y={l.top} width={plotW} height={l.h} className="lane-bg" />
                  {!l.bool && (
                    <>
                      <text x={LABEL_W - 4} y={l.top + 10} className="tick" textAnchor="end">
                        {fmt(hi)}
                      </text>
                      <text x={LABEL_W - 4} y={l.top + l.h - 2} className="tick" textAnchor="end">
                        {fmt(lo)}
                      </text>
                    </>
                  )}
                  <rect x={4} y={l.top + 6} width={8} height={8} rx={2} className="swatch" />
                  <text x={16} y={l.top + 14} className="lane-label">
                    {l.key}
                  </text>
                  <text x={16} y={l.top + 28} className="lane-value">
                    {cur === undefined ? '—' : typeof cur === 'boolean' ? (cur ? '1' : '0') : `${fmt(cur)} ${l.info?.unit ?? ''}`}
                  </text>
                  <path d={d} className="series" />
                  <g className="lane-remove" onClick={() => remove(l.key)}>
                    <title>Kaldır</title>
                    <rect x={LABEL_W - 4 - 14} y={l.top + l.h / 2 - 7} width={14} height={14} rx={3} />
                    <text x={LABEL_W - 11} y={l.top + l.h / 2 + 4} textAnchor="middle">
                      ×
                    </text>
                  </g>
                </g>
              );
            })}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={xOf(t)} y1={0} x2={xOf(t)} y2={height - AXIS_H} className="grid" />
                <text x={xOf(t)} y={height - 6} className="tick" textAnchor="middle">
                  {Math.round((t - now) / 1000) === 0 ? 0 : Math.round((t - now) / 1000)} s
                </text>
              </g>
            ))}
            {hoverSample && (
              <g className="crosshair">
                <line x1={xOf(hoverSample.t)} y1={0} x2={xOf(hoverSample.t)} y2={height - AXIS_H} />
                {placed.map((l) => {
                  const v = hoverSample.v[l.i];
                  if (v === null || v === undefined) return null;
                  const x = xOf(hoverSample.t);
                  const right = x > LABEL_W + plotW - 110;
                  return (
                    <text key={l.key} x={right ? x - 6 : x + 6} y={l.top + 14} textAnchor={right ? 'end' : 'start'} className="hover-value">
                      {l.bool ? (v ? '1' : '0') : `${fmt(v)} ${l.info?.unit ?? ''}`}
                    </text>
                  );
                })}
                <text x={xOf(hoverSample.t)} y={height - 6} className="hover-time" textAnchor="middle">
                  {(hoverSample.t / 1000).toFixed(2)} s
                </text>
              </g>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

/** Bileşene göre gruplanmış sinyal seçici. */
function SignalPicker({
  signals,
  selected,
  disabled,
  onPick,
}: {
  signals: NamedSignal[];
  selected: string[];
  disabled: boolean;
  onPick(key: string): void;
}) {
  const groups = new Map<string, NamedSignal[]>();
  for (const s of signals) {
    const name = s.key.split('.')[0]!;
    groups.set(name, [...(groups.get(name) ?? []), s]);
  }
  return (
    <select value="" disabled={disabled} onChange={(e) => onPick(e.target.value)} aria-label="Sinyal ekle">
      <option value="">+ Sinyal ekle…</option>
      {[...groups].map(([name, list]) => (
        <optgroup key={name} label={name}>
          {list.map((s) => (
            <option key={s.key} value={s.key} disabled={selected.includes(s.key)}>
              {s.label}
              {s.unit ? ` [${s.unit}]` : ''} — {s.key}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
