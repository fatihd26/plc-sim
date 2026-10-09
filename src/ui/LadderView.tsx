// Ladder programının SVG görünümü ve online izleme (güç akışı renklendirmesi).
// Yerleşim seri/paralel ağaçtan türetilir: seri = yatay, paralel = dikey.

import type { ReactNode } from 'react';
import type { LadderNode, LadderTrace, Network } from '../sim/ladder';

const CW = 120; // hücre genişliği
const CH = 76; // hücre yüksekliği
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

function renderNode(node: LadderNode, x: number, row: number, w: number, trace: LadderTrace, out: ReactNode[]): void {
  const st = trace[node.id];
  switch (node.kind) {
    case 'contact': {
      const x0 = px(x);
      const mid = x0 + CW / 2;
      const y = cy(row);
      const closed = st?.closed ?? false;
      out.push(
        <g key={node.id} className={closed ? 'contact closed' : 'contact'}>
          <Wire x1={x0} y1={y} x2={mid - 10} y2={y} on={st?.powerIn ?? false} />
          <Wire x1={mid + 10} y1={y} x2={px(x + w)} y2={y} on={st?.powerOut ?? false} />
          {closed && <rect x={mid - 10} y={y - 14} width={20} height={28} className="contact-fill" />}
          <line x1={mid - 10} y1={y - 15} x2={mid - 10} y2={y + 15} className="plate" />
          <line x1={mid + 10} y1={y - 15} x2={mid + 10} y2={y + 15} className="plate" />
          {node.contact === 'NC' && <line x1={mid - 14} y1={y + 15} x2={mid + 14} y2={y - 15} className="plate" />}
          <text x={mid} y={y - 22} className="addr">
            {node.address}
          </text>
          <text x={mid} y={y + 30} className="label">
            {node.label ?? ''}
          </text>
        </g>,
      );
      return;
    }
    case 'series': {
      let cx = x;
      node.items.forEach((item, i) => {
        const last = i === node.items.length - 1;
        const iw = last ? x + w - cx : measure(item).w;
        renderNode(item, cx, row, iw, trace, out);
        cx += iw;
      });
      return;
    }
    case 'parallel': {
      let r = row;
      let lastRow = row;
      for (const branch of node.branches) {
        renderNode(branch, x, r, w, trace, out);
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

function NetworkView({ network, trace }: { network: Network; trace: LadderTrace }) {
  const size = measure(network.logic);
  const elements: ReactNode[] = [];
  renderNode(network.logic, 0, 0, size.w, trace, elements);

  const coilOn = trace[network.coil.id]?.powerOut ?? false;
  const coilX = px(size.w) + CW / 2;
  const y = cy(0);
  const width = px(size.w + 1) + RAIL;
  const height = size.h * CH + 16;

  return (
    <figure className="network">
      <figcaption>
        <strong>{network.id}</strong> {network.title}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={network.title}>
        <line x1={RAIL} y1={4} x2={RAIL} y2={height - 4} className="rail on" />
        <line x1={width - RAIL} y1={4} x2={width - RAIL} y2={height - 4} className="rail" />
        {elements}
        <g className={coilOn ? 'coil on' : 'coil'}>
          <Wire x1={px(size.w)} y1={y} x2={coilX - 16} y2={y} on={coilOn} />
          <path d={`M ${coilX - 8} ${y - 15} Q ${coilX - 18} ${y} ${coilX - 8} ${y + 15}`} className="plate" />
          <path d={`M ${coilX + 8} ${y - 15} Q ${coilX + 18} ${y} ${coilX + 8} ${y + 15}`} className="plate" />
          <Wire x1={coilX + 16} y1={y} x2={width - RAIL} y2={y} on={false} />
          <text x={coilX} y={y - 22} className="addr">
            {network.coil.address}
          </text>
          <text x={coilX} y={y + 30} className="label">
            {network.coil.label ?? ''}
          </text>
        </g>
      </svg>
    </figure>
  );
}

export function LadderView({ networks, trace }: { networks: Network[]; trace: LadderTrace }) {
  return (
    <div className="ladder">
      {networks.map((n) => (
        <NetworkView key={n.id} network={n} trace={trace} />
      ))}
    </div>
  );
}
