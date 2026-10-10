// Ladder programının SVG görünümü ve online izleme (güç akışı renklendirmesi).
// Yerleşim seri/paralel ağaçtan türetilir: seri = yatay, paralel = dikey.

import type { ReactNode } from 'react';
import type { LadderNode, LadderTrace, Network } from '../sim/ladder';
import { symbolName, type SymbolTable } from '../sim/symbolTable';

const CW = 120; // hücre genişliği
const CH = 86; // hücre yüksekliği
const RAIL = 16;

interface Size {
  w: number;
  h: number;
}

function measure(node: LadderNode): Size {
  switch (node.kind) {
    case 'contact':
      return { w: 1, h: 1 };
    case 'series': {
      const sizes = node.items.map(measure);
      return { w: sizes.reduce((a, s) => a + s.w, 0), h: Math.max(...sizes.map((s) => s.h)) };
    }
    case 'parallel': {
      const sizes = node.branches.map(measure);
      return { w: Math.max(...sizes.map((s) => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) };
    }
  }
}

const px = (unitX: number) => RAIL + unitX * CW;
const cy = (row: number) => row * CH + CH / 2 + 8;

function Wire({ x1, y1, x2, y2, on }: { x1: number; y1: number; x2: number; y2: number; on: boolean }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} className={on ? 'wire on' : 'wire'} />;
}

interface Ctx {
  trace: LadderTrace;
  symbols: SymbolTable;
  selected: string | null;
  onSelect?(id: string): void;
}

/** Eleman altındaki metin: sembol tablosundan eleman adı, varsa açıklama. */
function Caption({ x, y, address, label, symbols }: { x: number; y: number; address: string; label?: string; symbols: SymbolTable }) {
  const sym = symbolName(symbols, address);
  return (
    <>
      <text x={x} y={y + 30} className="label">
        {sym || (label ? '' : '—')}
      </text>
      {label && (
        <text x={x} y={y + (sym ? 42 : 30)} className="comment">
          {label}
        </text>
      )}
    </>
  );
}

function renderNode(node: LadderNode, x: number, row: number, w: number, ctx: Ctx, out: ReactNode[]): void {
  const st = ctx.trace[node.id];
  switch (node.kind) {
    case 'contact': {
      const x0 = px(x);
      const mid = x0 + CW / 2;
      const y = cy(row);
      const closed = st?.closed ?? false;
      out.push(
        <g
          key={node.id}
          className={`contact${closed ? ' closed' : ''}${ctx.selected === node.id ? ' selected' : ''}${ctx.onSelect ? ' pickable' : ''}`}
          onClick={ctx.onSelect && (() => ctx.onSelect!(node.id))}
        >
          {ctx.onSelect && <rect x={x0 + 4} y={y - 34} width={CW - 8} height={CH - 14} className="pick" />}
          <Wire x1={x0} y1={y} x2={mid - 10} y2={y} on={st?.powerIn ?? false} />
          <Wire x1={mid + 10} y1={y} x2={px(x + w)} y2={y} on={st?.powerOut ?? false} />
          {closed && <rect x={mid - 10} y={y - 14} width={20} height={28} className="contact-fill" />}
          <line x1={mid - 10} y1={y - 15} x2={mid - 10} y2={y + 15} className="plate" />
          <line x1={mid + 10} y1={y - 15} x2={mid + 10} y2={y + 15} className="plate" />
          {node.contact === 'NC' && <line x1={mid - 14} y1={y + 15} x2={mid + 14} y2={y - 15} className="plate" />}
          <text x={mid} y={y - 22} className="addr">
            {node.address}
          </text>
          <Caption x={mid} y={y} address={node.address} label={node.label} symbols={ctx.symbols} />
        </g>,
      );
      return;
    }
    case 'series': {
      let cx = x;
      node.items.forEach((item, i) => {
        const last = i === node.items.length - 1;
        const iw = last ? x + w - cx : measure(item).w;
        renderNode(item, cx, row, iw, ctx, out);
        cx += iw;
      });
      return;
    }
    case 'parallel': {
      let r = row;
      let lastRow = row;
      for (const branch of node.branches) {
        renderNode(branch, x, r, w, ctx, out);
        lastRow = r;
        r += measure(branch).h;
      }
      out.push(
        <Wire key={`${node.id}.L`} x1={px(x)} y1={cy(row)} x2={px(x)} y2={cy(lastRow)} on={st?.powerIn ?? false} />,
        <Wire
          key={`${node.id}.R`}
          x1={px(x + w)}
          y1={cy(row)}
          x2={px(x + w)}
          y2={cy(lastRow)}
          on={st?.powerOut ?? false}
        />,
      );
      return;
    }
  }
}

function NetworkView({ network, ctx }: { network: Network; ctx: Ctx }) {
  const size = measure(network.logic);
  const elements: ReactNode[] = [];
  renderNode(network.logic, 0, 0, size.w, ctx, elements);

  const coilOn = ctx.trace[network.coil.id]?.powerOut ?? false;
  const coilX = px(size.w) + CW / 2;
  const y = cy(0);
  const width = px(size.w + 1) + RAIL;
  const height = size.h * CH + 16;
  const pick = ctx.onSelect;

  return (
    <figure className={`network${ctx.selected === network.id ? ' selected' : ''}`}>
      <figcaption className={pick ? 'pickable' : undefined} onClick={pick && (() => pick(network.id))}>
        <strong>{network.id}</strong> {network.title}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={network.title}>
        <line x1={RAIL} y1={4} x2={RAIL} y2={height - 4} className={pick ? 'rail' : 'rail on'} />
        <line x1={width - RAIL} y1={4} x2={width - RAIL} y2={height - 4} className="rail" />
        {elements}
        <g
          className={`coil${coilOn ? ' on' : ''}${ctx.selected === network.coil.id ? ' selected' : ''}${pick ? ' pickable' : ''}`}
          onClick={pick && (() => pick(network.coil.id))}
        >
          {pick && <rect x={coilX - CW / 2 + 4} y={y - 34} width={CW - 8} height={CH - 14} className="pick" />}
          <Wire x1={px(size.w)} y1={y} x2={coilX - 16} y2={y} on={coilOn} />
          <path d={`M ${coilX - 8} ${y - 15} Q ${coilX - 18} ${y} ${coilX - 8} ${y + 15}`} className="plate" />
          <path d={`M ${coilX + 8} ${y - 15} Q ${coilX + 18} ${y} ${coilX + 8} ${y + 15}`} className="plate" />
          <Wire x1={coilX + 16} y1={y} x2={width - RAIL} y2={y} on={false} />
          <text x={coilX} y={y - 22} className="addr">
            {network.coil.address}
          </text>
          <Caption x={coilX} y={y} address={network.coil.address} label={network.coil.label} symbols={ctx.symbols} />
        </g>
      </svg>
    </figure>
  );
}

interface LadderViewProps {
  networks: Network[];
  /** Online izleme verisi; yoksa (düzenleme) güç akışı gösterilmez. */
  trace?: LadderTrace;
  /** Adres → şemadaki eleman adları. */
  symbols: SymbolTable;
  selected?: string | null;
  onSelect?(id: string): void;
}

export function LadderView({ networks, trace, symbols, selected = null, onSelect }: LadderViewProps) {
  const ctx: Ctx = { trace: trace ?? {}, symbols, selected, onSelect };
  return (
    <div className="ladder">
      {networks.map((n) => (
        <NetworkView key={n.id} network={n} ctx={ctx} />
      ))}
      {networks.length === 0 && <p className="dock-note">Program boş. "+ Network" ile bir satır ekleyin.</p>}
    </div>
  );
}
