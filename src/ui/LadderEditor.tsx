// Ladder programı editörü: network ekleme/sıralama, seri/paralel kontak, adres ve kontak tipi.
// Program PLC bileşen örneğinde saklanır; her değişiklik tek bir geri alınabilir adımdır.

import { useState } from 'react';
import { formatAddress, parseAddress } from '../sim/address';
import type { LadderProgram } from '../sim/ladder';
import {
  addNetwork,
  addParallel,
  addSeries,
  findContact,
  networkOf,
  moveNetwork,
  removeContact,
  removeNetwork,
  renameNetwork,
  updateCoil,
  updateContact,
} from '../sim/ladderEdit';
import { symbolName, type SymbolTable } from '../sim/symbolTable';
import { LadderView } from './LadderView';

interface Props {
  program: LadderProgram;
  symbols: SymbolTable;
  onChange(program: LadderProgram): void;
}

/** Geçerliyse adresi normal biçimde döndürür, değilse hata metni. */
function checkAddress(text: string, coil: boolean): { ok: string } | { error: string } {
  try {
    const a = parseAddress(text);
    if (coil && a.area === 'I') return { error: 'Bobin giriş alanına (%I) yazamaz' };
    return { ok: formatAddress(a) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function LadderEditor({ program, symbols, onChange }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const net = program.networks.find((n) => n.id === selected || n.coil.id === selected);
  const contact = selected ? findContact(program, selected) : undefined;
  const owner = selected ? networkOf(program, selected) : undefined;
  const canAdd = !!contact || !!net;

  const apply = (r: { program: LadderProgram; contactId: string | null }) => {
    onChange(r.program);
    if (r.contactId) setSelected(r.contactId);
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
          disabled={!contact}
          title="Kontağı sil (network'ün son kontağı silinemez)"
          onClick={() => {
            onChange(removeContact(program, contact!.id));
            setSelected(null);
          }}
        >
          Kontağı sil
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
            setSelected(null);
          }}
        >
          Network sil
        </button>
      </div>
      <div className="ladder-edit-body">
        <div className="ladder-canvas">
          <LadderView networks={program.networks} symbols={symbols} selected={selected} onSelect={setSelected} />
        </div>
        <div className="ladder-inspector">
          {contact ? (
            <ElementForm
              key={contact.id + contact.address}
              title="Kontak"
              address={contact.address}
              label={contact.label ?? ''}
              coil={false}
              symbols={symbols}
              contactType={contact.contact}
              onAddress={(address) => onChange(updateContact(program, contact.id, { address }))}
              onLabel={(label) => onChange(updateContact(program, contact.id, { label }))}
              onType={(t) => onChange(updateContact(program, contact.id, { contact: t }))}
            />
          ) : net && selected === net.coil.id ? (
            <ElementForm
              key={net.coil.id + net.coil.address}
              title="Bobin"
              address={net.coil.address}
              label={net.coil.label ?? ''}
              coil
              symbols={symbols}
              onAddress={(address) => onChange(updateCoil(program, net.id, { address }))}
              onLabel={(label) => onChange(updateCoil(program, net.id, { label }))}
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
              Bir kontak, bobin veya network başlığı seçin. Kontak/bobin altındaki ad, adrese kablolanmış şema
              elemanından otomatik gelir.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ElementForm(props: {
  title: string;
  address: string;
  label: string;
  coil: boolean;
  symbols: SymbolTable;
  contactType?: 'NO' | 'NC';
  onAddress(address: string): void;
  onLabel(label: string): void;
  onType?(t: 'NO' | 'NC'): void;
}) {
  const [text, setText] = useState(props.address);
  const check = checkAddress(text, props.coil);
  const commit = () => {
    if ('ok' in check && check.ok !== props.address) props.onAddress(check.ok);
  };
  const sym = 'ok' in check ? symbolName(props.symbols, check.ok) : '';
  return (
    <div className="element-form">
      <h4>{props.title}</h4>
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
        <p className="muted small">Şemada: {sym || 'bağlı eleman yok'}</p>
      )}
      {props.onType && (
        <label>
          Kontak tipi
          <select value={props.contactType} onChange={(e) => props.onType!(e.target.value as 'NO' | 'NC')}>
            <option value="NO">NO ┤ ├ (bit 1 iken iletir)</option>
            <option value="NC">NC ┤/├ (bit 0 iken iletir)</option>
          </select>
        </label>
      )}
      <label>
        Açıklama
        <input
          defaultValue={props.label}
          placeholder="isteğe bağlı"
          onBlur={(e) => e.target.value !== props.label && props.onLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
    </div>
  );
}
