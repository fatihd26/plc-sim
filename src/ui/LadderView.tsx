// Ladder programının SVG görünümü ve online izleme (güç akışı renklendirmesi).
// Yerleşim seri/paralel ağaçtan türetilir: seri = yatay, paralel = dikey.

import { useState, type DragEvent, type ReactNode } from 'react';
import { INSTR_MIME } from '../sim/instructions';
import { BOX_SPECS } from '../sim/boxes';
import { isBox, isCounter, isTimer, type Coil, type LadderNode, type LadderTrace, type Network } from '../sim/ladder';
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
    case 'compare':
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
  /** Sürüklenen komutun bırakılacağı eleman (vurgulanır). */
  dropTarget?: string | null;
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
          data-drop={node.id}
          className={`contact${closed ? ' closed' : ''}${ctx.selected === node.id ? ' selected' : ''}${ctx.dropTarget === node.id ? ' drop-target' : ''}${ctx.onSelect ? ' pickable' : ''}`}
          onClick={ctx.onSelect && (() => ctx.onSelect!(node.id))}
        >
          {ctx.onSelect && <rect x={x0 + 4} y={y - 34} width={CW - 8} height={CH - 14} className="pick" />}
          <Wire x1={x0} y1={y} x2={mid - 10} y2={y} on={st?.powerIn ?? false} />
          <Wire x1={mid + 10} y1={y} x2={px(x + w)} y2={y} on={st?.powerOut ?? false} />
          {closed && <rect x={mid - 10} y={y - 14} width={20} height={28} className="contact-fill" />}
          <line x1={mid - 10} y1={y - 15} x2={mid - 10} y2={y + 15} className="plate" />
          <line x1={mid + 10} y1={y - 15} x2={mid + 10} y2={y + 15} className="plate" />
          {node.contact === 'NC' && <line x1={mid - 14} y1={y + 15} x2={mid + 14} y2={y - 15} className="plate" />}
          {(node.contact === 'P' || node.contact === 'N') && (
            <text x={mid} y={y + 5} className="op">
              {node.contact}
            </text>
          )}
          <text x={mid} y={y - 22} className="addr">
            {node.address}
          </text>
          <Caption x={mid} y={y} address={node.address} label={node.label} symbols={ctx.symbols} />
        </g>,
      );
      return;
    }
    case 'compare': {
      const x0 = px(x);
      const mid = x0 + CW / 2;
      const y = cy(row);
      const closed = st?.closed ?? false;
      out.push(
        <g
          key={node.id}
          data-drop={node.id}
          className={`contact compare${closed ? ' closed' : ''}${ctx.selected === node.id ? ' selected' : ''}${ctx.dropTarget === node.id ? ' drop-target' : ''}${ctx.onSelect ? ' pickable' : ''}`}
          onClick={ctx.onSelect && (() => ctx.onSelect!(node.id))}
        >
          {ctx.onSelect && <rect x={x0 + 4} y={y - 34} width={CW - 8} height={CH - 14} className="pick" />}
          <Wire x1={x0} y1={y} x2={mid - 26} y2={y} on={st?.powerIn ?? false} />
          <Wire x1={mid + 26} y1={y} x2={px(x + w)} y2={y} on={st?.powerOut ?? false} />
          <rect x={mid - 26} y={y - 14} width={52} height={28} rx={3} className={`box${closed ? ' on' : ''}`} />
          <text x={mid} y={y + 5} className="op">
            {node.op}
          </text>
          <text x={mid} y={y - 22} className="addr">
            {node.a}
          </text>
          <text x={mid} y={y + 27} className="addr">
            {node.b}
          </text>
          {node.label && (
            <text x={mid} y={y + 39} className="comment">
              {node.label}
            </text>
          )}
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

/** Süreyi okunur biçimde: 1500 → "1.5 s", 250 → "250 ms". */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${+(ms / 1000).toFixed(2)} s` : `${ms} ms`;
}

const COIL_MARK: Record<string, string> = { ncoil: '/', set: 'S', reset: 'R' };

/** Zamanlayıcı/sayıcı kutusunun satırları: ön ayar, anlık değer ve ek girişler. */
function boxLines(coil: Coil, value: number | undefined): string[] {
  const live = value === undefined ? '—' : null;
  if (isBox(coil.type)) {
    const spec = BOX_SPECS[coil.type];
    const lines = spec.args.map((a) => `${a.key} ${coil.args?.[a.key] ?? a.default}`);
    lines.push(`OUT ${coil.address}${live ? '' : ` = ${value}`}`);
    return lines;
  }
  if (isTimer(coil.type)) {
    const lines = [`PT ${formatMs(coil.preset ?? 0)}`, `ET ${live ?? formatMs(value!)}`];
    if (coil.type === 'TONR') lines.push(`R ${coil.reset ?? '—'}`);
    return lines;
  }
  const lines = [`PV ${coil.preset ?? 0}`, `CV ${live ?? value}`];
  if (coil.type === 'CTD') lines.push(`LD ${coil.load ?? '—'}`);
  else lines.push(`R ${coil.reset ?? '—'}`);
  if (coil.type === 'CTUD') lines.push(`CD ${coil.down ?? '—'}`);
  return lines;
}

function NetworkView({ network, ctx }: { network: Network; ctx: Ctx }) {
  const size = measure(network.logic);
  const elements: ReactNode[] = [];
  renderNode(network.logic, 0, 0, size.w, ctx, elements);

  const coil = network.coil;
  const st = ctx.trace[coil.id];
  const powerIn = st?.powerIn ?? false;
  const coilOn = st?.powerOut ?? false;
  const boxed = isTimer(coil.type) || isCounter(coil.type) || isBox(coil.type);
  const lines = boxed ? boxLines(coil, st?.value) : [];
  const boxH = 22 + lines.length * 13;
  const coilX = px(size.w) + CW / 2;
  const y = cy(0);
  const width = px(size.w + 1) + RAIL;
  const height = Math.max(size.h * CH, boxed ? y + boxH + 40 : 0) + 16;
  const pick = ctx.onSelect;
  const mark = COIL_MARK[coil.type ?? 'coil'];

  return (
    <figure
      data-drop={network.id}
      className={`network${ctx.selected === network.id ? ' selected' : ''}${ctx.dropTarget === network.id ? ' drop-target' : ''}`}
    >
      <figcaption className={pick ? 'pickable' : undefined} onClick={pick && (() => pick(network.id))}>
        <strong>{network.id}</strong> {network.title}
      </figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={network.title}>
        <line x1={RAIL} y1={4} x2={RAIL} y2={height - 4} className={pick ? 'rail' : 'rail on'} />
        <line x1={width - RAIL} y1={4} x2={width - RAIL} y2={height - 4} className="rail" />
        {elements}
        <g
          data-drop={coil.id}
          className={`coil${coilOn ? ' on' : ''}${ctx.selected === coil.id ? ' selected' : ''}${ctx.dropTarget === coil.id ? ' drop-target' : ''}${pick ? ' pickable' : ''}`}
          onClick={pick && (() => pick(coil.id))}
        >
          {pick && (
            <rect x={coilX - CW / 2 + 4} y={y - 34} width={CW - 8} height={Math.max(CH - 14, boxH + 30)} className="pick" />
          )}
          {boxed ? (
            <>
              <Wire x1={px(size.w)} y1={y} x2={coilX - 42} y2={y} on={powerIn} />
              <rect x={coilX - 42} y={y - 16} width={84} height={boxH} rx={3} className={`box${coilOn ? ' on' : ''}`} />
              <text x={coilX} y={y - 3} className="box-title">
                {coil.type}
              </text>
              {lines.map((line, i) => (
                <text key={line} x={coilX - 36} y={y + 13 + i * 13} className="box-line">
                  {line}
                </text>
              ))}
              <Wire x1={coilX + 42} y1={y} x2={width - RAIL} y2={y} on={coilOn} />
              <text x={coilX} y={y - 22} className="addr">
                {isBox(coil.type) ? '' : coil.address}
              </text>
              {coil.label && (
                <text x={coilX} y={y + boxH + 10} className="comment">
                  {coil.label}
                </text>
              )}
            </>
          ) : (
            <>
              <Wire x1={px(size.w)} y1={y} x2={coilX - 16} y2={y} on={powerIn} />
              <path d={`M ${coilX - 8} ${y - 15} Q ${coilX - 18} ${y} ${coilX - 8} ${y + 15}`} className="plate" />
              <path d={`M ${coilX + 8} ${y - 15} Q ${coilX + 18} ${y} ${coilX + 8} ${y + 15}`} className="plate" />
              {mark && (
                <text x={coilX} y={y + 5} className="op">
                  {mark}
                </text>
              )}
              <Wire x1={coilX + 16} y1={y} x2={width - RAIL} y2={y} on={false} />
              <text x={coilX} y={y - 22} className="addr">
                {coil.address}
              </text>
              <Caption x={coilX} y={y} address={coil.address} label={coil.label} symbols={ctx.symbols} />
            </>
          )}
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
  /**
   * Kütüphaneden sürüklenen komut bırakıldı. `target`: üzerine bırakılan eleman, bobin veya
   * network kimliği; boş alana bırakılınca null. `shift`: Shift basılıydı (paralel ekle).
   */
  onDropInstruction?(key: string, target: string | null, shift: boolean): void;
}

const isInstrDrag = (e: DragEvent) => e.dataTransfer.types.includes(INSTR_MIME);
const dropTargetOf = (e: DragEvent) => (e.target as Element).closest('[data-drop]')?.getAttribute('data-drop') ?? null;

export function LadderView({ networks, trace, symbols, selected = null, onSelect, onDropInstruction }: LadderViewProps) {
  const [dropTarget, setDropTarget] = useState<string | null | undefined>(undefined);
  const ctx: Ctx = { trace: trace ?? {}, symbols, selected, onSelect, dropTarget };
  const accepts = !!onDropInstruction;
  return (
    <div
      className={`ladder${dropTarget === null ? ' drop-empty' : ''}`}
      onDragOver={
        accepts
          ? (e) => {
              if (!isInstrDrag(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setDropTarget(dropTargetOf(e));
            }
          : undefined
      }
      onDragLeave={accepts ? (e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropTarget(undefined) : undefined}
      onDrop={
        accepts
          ? (e) => {
              const key = e.dataTransfer.getData(INSTR_MIME);
              setDropTarget(undefined);
              if (!key) return;
              e.preventDefault();
              onDropInstruction!(key, dropTargetOf(e), e.shiftKey);
            }
          : undefined
      }
    >
      {networks.map((n) => (
        <NetworkView key={n.id} network={n} ctx={ctx} />
      ))}
      {networks.length === 0 && (
        <p className="dock-note">Program boş. Kütüphaneden bir komut sürükleyin veya "+ Network" ile satır ekleyin.</p>
      )}
      {accepts && networks.length > 0 && (
        <p className="drop-hint">Yeni network için komutu buraya bırakın · Shift: paralel ekle</p>
      )}
    </div>
  );
}
