// Ladder programı editörü: komut kütüphanesi (kontak, karşılaştırma, bobin, set/reset,
// zamanlayıcı, sayıcı), network ekleme/sıralama, seri/paralel bağlama ve eleman özellikleri.
// Program PLC bileşen örneğinde saklanır; her değişiklik tek bir geri alınabilir adımdır.

import { useState, type ReactNode } from 'react';
import { formatOperand, formatValue, parseOperand, parseValue } from '../sim/address';
import { INSTR_MIME, INSTRUCTION_GROUPS, INSTRUCTIONS, type Instruction } from '../sim/instructions';
import {
  checkOutputAddress,
  COMPARE_OPS,
  isCounter,
  isTimer,
  type Coil,
  type CoilType,
  type CompareOp,
  type ContactType,
  type LadderProgram,
} from '../sim/ladder';
import {
  addNetwork,
  addParallel,
  addSeries,
  findElement,
  insertInstruction,
  moveNetwork,
  networkOf,
  removeContact,
  removeNetwork,
  renameNetwork,
  setOutputType,
  updateCoil,
  updateContact,
  type CoilPatch,
} from '../sim/ladderEdit';
import { symbolName, type SymbolTable } from '../sim/symbolTable';
import { formatMs, LadderView } from './LadderView';

interface Props {
  program: LadderProgram;
  symbols: SymbolTable;
  onChange(program: LadderProgram): void;
  selected: string | null;
  onSelect(id: string | null): void;
}

type Check = { ok: string } | { error: string };

const attempt = (fn: () => string): Check => {
  try {
    return { ok: fn() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
};

const CONTACT_OPTIONS: { value: ContactType; label: string }[] = [
  { value: 'NO', label: 'NO ┤ ├ (bit 1 iken iletir)' },
  { value: 'NC', label: 'NC ┤/├ (bit 0 iken iletir)' },
  { value: 'P', label: 'P ┤P├ (yükselen kenar)' },
  { value: 'N', label: 'N ┤N├ (düşen kenar)' },
];

const OUTPUT_OPTIONS = INSTRUCTIONS.filter((i) => i.action.kind === 'output');

export function LadderEditor({ program, symbols, onChange, selected, onSelect }: Props) {
  const [parallelMode, setParallelMode] = useState(false);
  const net = program.networks.find((n) => n.id === selected || n.coil.id === selected);
  const element = selected ? findElement(program, selected) : undefined;
  const owner = selected ? networkOf(program, selected) : undefined;
  const canAdd = !!element || !!net;

  const apply = (r: { program: LadderProgram; contactId: string | null }) => {
    onChange(r.program);
    if (r.contactId) onSelect(r.contactId);
  };
  const insert = (instr: Instruction) => {
    const r = insertInstruction(program, selected, instr.action, parallelMode);
    onChange(r.program);
    if (r.selectId) onSelect(r.selectId);
  };
  // Sürükle-bırak: elemana bırakılırsa sağına (Shift/Paralel: altına), bobine veya network'e
  // bırakılırsa o network'e; boş alana bırakılırsa yeni network.
  const drop = (key: string, target: string | null, shift: boolean) => {
    const instr = INSTRUCTIONS.find((i) => i.key === key);
    if (!instr) return;
    if (target === null) {
      const a = instr.action;
      const r = a.kind === 'output' ? addNetwork(program, a.type) : addNetwork(program, 'coil', a.template);
      onChange(r.program);
      onSelect(a.kind === 'output' ? r.coilId : r.contactId);
      return;
    }
    const r = insertInstruction(program, target, instr.action, parallelMode || shift);
    onChange(r.program);
    if (r.selectId) onSelect(r.selectId);
  };

  return (
    <div className="ladder-editor">
      <div className="ladder-toolbar" role="toolbar" aria-label="Ladder düzenleme">
        <button type="button" onClick={() => apply(addNetwork(program))}>
          + Network
        </button>
        <button type="button" disabled={!canAdd} title="Seçilenin sağına seri kontak (VE)" onClick={() => apply(addSeries(program, selected!))}>
          ┤├ Seri
        </button>
        <button
          type="button"
          disabled={!canAdd}
          title="Seçilene paralel kontak dalı (VEYA)"
          onClick={() => apply(addParallel(program, selected!))}
        >
          ⫴ Paralel
        </button>
        <button
          type="button"
          disabled={!element}
          title="Elemanı sil (network'ün son elemanı silinemez)"
          onClick={() => {
            onChange(removeContact(program, element!.id));
            onSelect(null);
          }}
        >
          Elemanı sil
        </button>
        <span className="sep" />
        <button type="button" disabled={!owner} onClick={() => onChange(moveNetwork(program, owner!.id, -1))}>
          ↑
        </button>
        <button type="button" disabled={!owner} onClick={() => onChange(moveNetwork(program, owner!.id, 1))}>
          ↓
        </button>
        <button
          type="button"
          className="danger"
          disabled={!owner}
          onClick={() => {
            onChange(removeNetwork(program, owner!.id));
            onSelect(null);
          }}
        >
          Network sil
        </button>
      </div>
      <div className="ladder-edit-body with-palette">
        <InstructionPalette onPick={insert} parallel={parallelMode} onParallel={setParallelMode} />
        <div className="ladder-canvas">
          <LadderView
            networks={program.networks}
            symbols={symbols}
            selected={selected}
            onSelect={onSelect}
            onDropInstruction={drop}
          />
        </div>
        <div className="ladder-inspector">
          {element?.kind === 'contact' ? (
            <AddressForm
              key={element.id + element.address}
              title="Kontak"
              address={element.address}
              label={element.label ?? ''}
              check={(t) => attempt(() => formatOperand(parseOperand(t)))}
              symbols={symbols}
              onAddress={(address) => onChange(updateContact(program, element.id, { address }))}
              onLabel={(label) => onChange(updateContact(program, element.id, { label }))}
            >
              <label>
                Kontak tipi
                <select
                  value={element.contact}
                  onChange={(e) => onChange(updateContact(program, element.id, { contact: e.target.value as ContactType }))}
                >
                  {CONTACT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </AddressForm>
          ) : element?.kind === 'compare' ? (
            <CompareForm
              key={element.id}
              a={element.a}
              b={element.b}
              op={element.op}
              label={element.label ?? ''}
              onPatch={(patch) => onChange(updateContact(program, element.id, patch))}
            />
          ) : net && selected === net.coil.id ? (
            <OutputForm
              key={net.coil.id + net.coil.type}
              coil={net.coil}
              symbols={symbols}
              onType={(t) => onChange(setOutputType(program, net.id, t))}
              onPatch={(patch) => onChange(updateCoil(program, net.id, patch))}
            />
          ) : net ? (
            <div className="element-form">
              <h4>Network {net.id}</h4>
              <label>
                Başlık
                <input
                  key={net.id + net.title}
                  defaultValue={net.title}
                  onBlur={(e) => e.target.value !== net.title && onChange(renameNetwork(program, net.id, e.target.value))}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </label>
            </div>
          ) : (
            <p className="dock-note">
              Soldaki komut kütüphanesinden bir komuta tıklayın: kontaklar seçilen elemanın sağına (veya paralel) eklenir,
              çıkış komutları seçili network'ün çıkışını değiştirir. Bir eleman seçip özelliklerini burada düzenleyin.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Komut kütüphanesi: gruplara ayrılmış ladder komutları. */
export function InstructionPalette({
  onPick,
  parallel,
  onParallel,
}: {
  onPick(instr: Instruction): void;
  parallel: boolean;
  onParallel(p: boolean): void;
}) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const q = query.trim().toLocaleLowerCase('tr');
  const shown = INSTRUCTIONS.filter(
    (i) =>
      !q ||
      i.title.toLocaleLowerCase('tr').includes(q) ||
      i.key.toLocaleLowerCase('tr').includes(q) ||
      i.description.toLocaleLowerCase('tr').includes(q),
  );
  return (
    <nav className="instr-palette" aria-label="PLC komutları">
      <div className="instr-head">
        <strong>PLC komutları</strong>
        <label className="instr-mode" title="Kontak/karşılaştırma seçilen elemana paralel (VEYA) eklensin">
          <input type="checkbox" checked={parallel} onChange={(e) => onParallel(e.target.checked)} /> Paralel
        </label>
      </div>
      <input
        className="instr-search"
        type="search"
        placeholder="Komut ara (TON, sayıcı…)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="instr-tip">Ladder üzerine sürükleyin veya tıklayın.</p>
      {INSTRUCTION_GROUPS.map((group) => {
        const items = shown.filter((i) => i.group === group);
        if (!items.length) return null;
        const isClosed = !q && closed[group];
        return (
          <section key={group}>
            <h5>
              <button
                type="button"
                className="cat-toggle"
                aria-expanded={!isClosed}
                onClick={() => setClosed((c) => ({ ...c, [group]: !c[group] }))}
              >
                <span className="chevron">{isClosed ? '▸' : '▾'}</span> {group}
              </button>
            </h5>
            {!isClosed && (
              <ul>
                {items.map((i) => (
                  <li key={i.key}>
                    <button
                      type="button"
                      className="instr"
                      draggable
                      title={`${i.description}
Tıklayın veya ladder üzerine sürükleyin`}
                      onClick={() => onPick(i)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(INSTR_MIME, i.key);
                        e.dataTransfer.effectAllowed = 'copy';
                      }}
                    >
                      <span className="instr-symbol mono">{i.symbol}</span>
                      <span className="instr-title">{i.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {shown.length === 0 && <p className="instr-tip">Eşleşen komut yok.</p>}
    </nav>
  );
}

/** Adresli eleman formu (kontak ve bit bobini): adres, şemadaki karşılığı, açıklama. */
function AddressForm(props: {
  title: string;
  address: string;
  label: string;
  symbols: SymbolTable;
  check(text: string): Check;
  onAddress(address: string): void;
  onLabel(label: string): void;
  children?: ReactNode;
}) {
  const [text, setText] = useState(props.address);
  const check = props.check(text);
  const commit = () => {
    if ('ok' in check && check.ok !== props.address) props.onAddress(check.ok);
  };
  const sym = 'ok' in check ? symbolName(props.symbols, check.ok) : '';
  return (
    <div className="element-form">
      <h4>{props.title}</h4>
      {props.children}
      <label>
        Adres
        <input
          className="mono"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </label>
      {'error' in check ? (
        <p className="error small">{check.error}</p>
      ) : (
        <p className="muted small">
          {/^[TC]/.test(check.ok) ? `${check.ok[0] === 'T' ? 'Zamanlayıcı' : 'Sayıcı'} çıkışı (Q)` : `Şemada: ${sym || 'bağlı eleman yok'}`}
        </p>
      )}
      <LabelInput label={props.label} onLabel={props.onLabel} />
    </div>
  );
}

function LabelInput({ label, onLabel }: { label: string; onLabel(label: string): void }) {
  return (
    <label>
      Açıklama
      <input
        defaultValue={label}
        placeholder="isteğe bağlı"
        onBlur={(e) => e.target.value !== label && onLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

/** Doğrulanan, Enter/odak kaybında işlenen metin alanı. */
function CheckedInput({
  label,
  value,
  check,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  check(text: string): Check;
  onCommit(value: string): void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const result = text.trim() === '' && placeholder ? { ok: '' } : check(text);
  const commit = () => {
    if ('ok' in result && result.ok !== value) onCommit(result.ok);
  };
  return (
    <>
      <label>
        {label}
        <input
          className="mono"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </label>
      {'error' in result && <p className="error small">{result.error}</p>}
    </>
  );
}

function CompareForm(props: {
  a: string;
  b: string;
  op: CompareOp;
  label: string;
  onPatch(patch: { a?: string; b?: string; op?: CompareOp; label?: string }): void;
}) {
  const check = (t: string) => attempt(() => formatValue(parseValue(t)));
  return (
    <div className="element-form">
      <h4>Karşılaştırma</h4>
      <CheckedInput label="A" value={props.a} check={check} onCommit={(a) => props.onPatch({ a })} />
      <label>
        İşlem
        <select value={props.op} onChange={(e) => props.onPatch({ op: e.target.value as CompareOp })}>
          {COMPARE_OPS.map((op) => (
            <option key={op} value={op}>
              A {op} B
            </option>
          ))}
        </select>
      </label>
      <CheckedInput label="B" value={props.b} check={check} onCommit={(b) => props.onPatch({ b })} />
      <p className="muted small">Operand: tamsayı, T0 (geçen süre, ms) veya C0 (sayıcı değeri).</p>
      <LabelInput label={props.label} onLabel={(label) => props.onPatch({ label })} />
    </div>
  );
}

function OutputForm({
  coil,
  symbols,
  onType,
  onPatch,
}: {
  coil: Coil;
  symbols: SymbolTable;
  onType(t: CoilType): void;
  onPatch(patch: CoilPatch): void;
}) {
  const type = coil.type ?? 'coil';
  const box = isTimer(type) || isCounter(type);
  const bit = (t: string) => attempt(() => formatOperand(parseOperand(t)));
  const typeSelect = (
    <label>
      Çıkış komutu
      <select value={type} onChange={(e) => onType(e.target.value as CoilType)}>
        {OUTPUT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.symbol} {o.title}
          </option>
        ))}
      </select>
    </label>
  );
  if (!box) {
    return (
      <AddressForm
        key={coil.address}
        title="Çıkış"
        address={coil.address}
        label={coil.label ?? ''}
        symbols={symbols}
        check={(t) => attempt(() => checkOutputAddress(type, t))}
        onAddress={(address) => onPatch({ address })}
        onLabel={(label) => onPatch({ label })}
      >
        {typeSelect}
      </AddressForm>
    );
  }
  const timer = isTimer(type);
  return (
    <div className="element-form">
      <h4>{timer ? 'Zamanlayıcı' : 'Sayıcı'}</h4>
      {typeSelect}
      <CheckedInput
        key={`a${coil.address}`}
        label="Adres"
        value={coil.address}
        check={(t) => attempt(() => checkOutputAddress(type, t))}
        onCommit={(address) => onPatch({ address })}
      />
      <CheckedInput
        key={`p${coil.preset}`}
        label={timer ? 'PT – ön ayar süresi (ms)' : 'PV – ön ayar değeri'}
        value={String(coil.preset ?? 0)}
        check={(t) =>
          attempt(() => {
            const v = Number(t.trim());
            const max = timer ? 3_600_000 : 32767;
            if (!/^\d+$/.test(t.trim()) || v > max) throw new Error(`0..${max} arası tamsayı olmalı`);
            return String(v);
          })
        }
        onCommit={(v) => onPatch({ preset: Number(v) })}
      />
      {timer && <p className="muted small">= {formatMs(coil.preset ?? 0)}</p>}
      {(type === 'TONR' || type === 'CTU' || type === 'CTUD') && (
        <CheckedInput
          key={`r${coil.reset}`}
          label="R – sıfırlama girişi"
          value={coil.reset ?? ''}
          placeholder="boş = kullanılmaz"
          check={bit}
          onCommit={(reset) => onPatch({ reset })}
        />
      )}
      {type === 'CTD' && (
        <CheckedInput
          key={`l${coil.load}`}
          label="LD – yükleme girişi (CV = PV)"
          value={coil.load ?? ''}
          placeholder="boş = kullanılmaz"
          check={bit}
          onCommit={(load) => onPatch({ load })}
        />
      )}
      {type === 'CTUD' && (
        <CheckedInput
          key={`d${coil.down}`}
          label="CD – aşağı sayma girişi"
          value={coil.down ?? ''}
          placeholder="boş = kullanılmaz"
          check={bit}
          onCommit={(down) => onPatch({ down })}
        />
      )}
      <p className="muted small">
        {OUTPUT_OPTIONS.find((o) => o.key === type)?.description} Kontakta {coil.address} çıkışı, karşılaştırmada{' '}
        {timer ? 'geçen süre (ms)' : 'sayaç değeri'} olarak kullanılır.
      </p>
      <LabelInput label={coil.label ?? ''} onLabel={(label) => onPatch({ label })} />
    </div>
  );
}
