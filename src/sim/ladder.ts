// Ladder programı modeli ve güç akışı değerlendiricisi.
// Rung, seri/paralel bir ağaç olarak modellenir; görsel ızgara bundan türetilir.

import { parseAddress, type BitAddress } from './address';

export type ContactType = 'NO' | 'NC';

export type LadderNode =
  | { kind: 'contact'; id: string; address: string; contact: ContactType; label?: string }
  | { kind: 'series'; id: string; items: LadderNode[] }
  | { kind: 'parallel'; id: string; branches: LadderNode[] };

export interface Coil {
  id: string;
  address: string;
  label?: string;
}

export interface Network {
  id: string;
  title: string;
  logic: LadderNode;
  coil: Coil;
}

export interface LadderProgram {
  networks: Network[];
}

/** Bir elemanın son scan'deki durumu (online izleme için). */
export interface ElementState {
  powerIn: boolean;
  powerOut: boolean;
  /** Yalnız kontaklarda: kontak iletimde mi (güç olsun olmasın). */
  closed?: boolean;
}

export type LadderTrace = Record<string, ElementState>;

export type BitReader = (addr: BitAddress) => boolean;
export type BitWriter = (addr: BitAddress, value: boolean) => void;

// Derlenmiş ağaç: adresler bir kez çözülür, scan sırasında string ayrıştırma yapılmaz.
type CompiledNode =
  | { kind: 'contact'; id: string; addr: BitAddress; contact: ContactType }
  | { kind: 'series'; id: string; items: CompiledNode[] }
  | { kind: 'parallel'; id: string; branches: CompiledNode[] };

interface CompiledNetwork {
  logic: CompiledNode;
  coilId: string;
  coilAddr: BitAddress;
}

export interface CompiledProgram {
  networks: CompiledNetwork[];
}

export function compileProgram(program: LadderProgram): CompiledProgram {
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (ids.has(id)) throw new Error(`Tekrarlanan eleman kimliği: "${id}"`);
    ids.add(id);
  };

  const compileNode = (node: LadderNode): CompiledNode => {
    claim(node.id);
    switch (node.kind) {
      case 'contact':
        return { kind: 'contact', id: node.id, addr: parseAddress(node.address), contact: node.contact };
      case 'series':
        if (node.items.length === 0) throw new Error(`Boş seri grup: "${node.id}"`);
        return { kind: 'series', id: node.id, items: node.items.map(compileNode) };
      case 'parallel':
        if (node.branches.length === 0) throw new Error(`Boş paralel grup: "${node.id}"`);
        return { kind: 'parallel', id: node.id, branches: node.branches.map(compileNode) };
    }
  };

  return {
    networks: program.networks.map((net) => {
      claim(net.id);
      const logic = compileNode(net.logic);
      claim(net.coil.id);
      const coilAddr = parseAddress(net.coil.address);
      if (coilAddr.area === 'I') {
        throw new Error(`Bobin giriş alanına yazamaz: "${net.coil.address}"`);
      }
      return { logic, coilId: net.coil.id, coilAddr };
    }),
  };
}

function evalNode(node: CompiledNode, powerIn: boolean, read: BitReader, trace: LadderTrace): boolean {
  let powerOut: boolean;
  switch (node.kind) {
    case 'contact': {
      const bit = read(node.addr);
      const closed = node.contact === 'NO' ? bit : !bit;
      powerOut = powerIn && closed;
      trace[node.id] = { powerIn, powerOut, closed };
      return powerOut;
    }
    case 'series': {
      let p = powerIn;
      // Kısa devre değerlendirmesi yapılmaz: tüm elemanların durumu izleme için hesaplanır.
      for (const item of node.items) p = evalNode(item, p, read, trace);
      powerOut = p;
      break;
    }
    case 'parallel': {
      let any = false;
      for (const branch of node.branches) {
        if (evalNode(branch, powerIn, read, trace)) any = true;
      }
      powerOut = any;
      break;
    }
  }
  trace[node.id] = { powerIn, powerOut };
  return powerOut;
}

/**
 * Programı bir kez çalıştırır: network'ler yukarıdan aşağı, her biri soldan sağa.
 * Bobin yazımı hemen etkilidir; sonraki network'ler yeni değeri görür.
 */
export function executeProgram(
  program: CompiledProgram,
  read: BitReader,
  write: BitWriter,
): LadderTrace {
  const trace: LadderTrace = {};
  for (const net of program.networks) {
    const power = evalNode(net.logic, true, read, trace);
    write(net.coilAddr, power);
    trace[net.coilId] = { powerIn: power, powerOut: power };
  }
  return trace;
}
