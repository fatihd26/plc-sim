// Ladder programı üzerinde saf düzenleme işlemleri (editör için). Her işlem yeni bir program
// döndürür; geçersiz işlem (ör. network'ün son kontağını silmek) programı değiştirmeden döndürür.
// Ağaç her işlemden sonra normalize edilir: tek elemanlı seri/paralel grup elemana indirgenir,
// iç içe aynı tür gruplar düzleştirilir.

import type { ContactType, LadderNode, LadderProgram, Network } from './ladder';

type Contact = Extract<LadderNode, { kind: 'contact' }>;

/** Programda kullanılmayan "e<n>" biçiminde kimlik üretir. */
function idFactory(program: LadderProgram): () => string {
  const used = new Set<string>();
  const visit = (n: LadderNode) => {
    used.add(n.id);
    if (n.kind === 'series') n.items.forEach(visit);
    if (n.kind === 'parallel') n.branches.forEach(visit);
  };
  for (const net of program.networks) {
    used.add(net.id);
    used.add(net.coil.id);
    visit(net.logic);
  }
  let i = 0;
  return () => {
    let id: string;
    do id = `e${++i}`;
    while (used.has(id));
    used.add(id);
    return id;
  };
}

function normalize(node: LadderNode): LadderNode {
  if (node.kind === 'contact') return node;
  if (node.kind === 'series') {
    const items = node.items.map(normalize).flatMap((n) => (n.kind === 'series' ? n.items : [n]));
    return items.length === 1 ? items[0]! : { ...node, items };
  }
  const branches = node.branches.map(normalize).flatMap((n) => (n.kind === 'parallel' ? n.branches : [n]));
  return branches.length === 1 ? branches[0]! : { ...node, branches };
}

/** Ağaçta `id`'yi `fn` ile değiştirir. `fn` null döndürürse düğüm silinir. */
function mapNode(node: LadderNode, id: string, fn: (n: LadderNode) => LadderNode | null): LadderNode | null {
  if (node.id === id) return fn(node);
  if (node.kind === 'series') {
    const items = node.items.map((n) => mapNode(n, id, fn)).filter((n): n is LadderNode => n !== null);
    return items.length ? { ...node, items } : null;
  }
  if (node.kind === 'parallel') {
    const branches = node.branches.map((n) => mapNode(n, id, fn)).filter((n): n is LadderNode => n !== null);
    return branches.length ? { ...node, branches } : null;
  }
  return node;
}

function contains(node: LadderNode, id: string): boolean {
  if (node.id === id) return true;
  if (node.kind === 'series') return node.items.some((n) => contains(n, id));
  if (node.kind === 'parallel') return node.branches.some((n) => contains(n, id));
  return false;
}

function updateNetwork(program: LadderProgram, netId: string, fn: (n: Network) => Network): LadderProgram {
  return { ...program, networks: program.networks.map((n) => (n.id === netId ? fn(n) : n)) };
}

/** Elemanı (kontak, bobin, grup) içeren network. */
export const networkOf = (program: LadderProgram, elementId: string) =>
  program.networks.find((n) => n.id === elementId || n.coil.id === elementId || contains(n.logic, elementId));

export function findContact(program: LadderProgram, id: string): Contact | undefined {
  let found: Contact | undefined;
  const visit = (n: LadderNode) => {
    if (n.id === id && n.kind === 'contact') found = n;
    if (n.kind === 'series') n.items.forEach(visit);
    if (n.kind === 'parallel') n.branches.forEach(visit);
  };
  program.networks.forEach((n) => visit(n.logic));
  return found;
}

export function addNetwork(program: LadderProgram): { program: LadderProgram; contactId: string } {
  const next = idFactory(program);
  const used = new Set(program.networks.map((n) => n.id));
  let k = program.networks.length + 1;
  while (used.has(`N${k}`)) k++;
  const contactId = next();
  const network: Network = {
    id: `N${k}`,
    title: `Network ${k}`,
    logic: { kind: 'contact', id: contactId, address: '%I0.0', contact: 'NO' },
    coil: { id: next(), address: `%Q0.${Math.min(7, program.networks.length)}` },
  };
  return { program: { ...program, networks: [...program.networks, network] }, contactId };
}

export function removeNetwork(program: LadderProgram, netId: string): LadderProgram {
  return { ...program, networks: program.networks.filter((n) => n.id !== netId) };
}

export function moveNetwork(program: LadderProgram, netId: string, delta: -1 | 1): LadderProgram {
  const i = program.networks.findIndex((n) => n.id === netId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= program.networks.length) return program;
  const networks = [...program.networks];
  [networks[i], networks[j]] = [networks[j]!, networks[i]!];
  return { ...program, networks };
}

export function renameNetwork(program: LadderProgram, netId: string, title: string): LadderProgram {
  return updateNetwork(program, netId, (n) => ({ ...n, title }));
}

/**
 * `targetId` elemanının sağına seri yeni bir kontak ekler. Hedef network'ün kendisiyse
 * kontak bobinin hemen önüne (mantığın sonuna) eklenir.
 */
export function addSeries(program: LadderProgram, targetId: string): { program: LadderProgram; contactId: string | null } {
  const net = networkOf(program, targetId);
  if (!net) return { program, contactId: null };
  const next = idFactory(program);
  const contact: Contact = { kind: 'contact', id: next(), address: '%I0.0', contact: 'NO' };
  const target = targetId === net.id || targetId === net.coil.id ? net.logic.id : targetId;
  const logic = mapNode(net.logic, target, (n) => ({ kind: 'series', id: next(), items: [n, contact] }));
  return {
    program: updateNetwork(program, net.id, (n) => ({ ...n, logic: normalize(logic!) })),
    contactId: contact.id,
  };
}

/** `targetId` elemanına paralel yeni bir kontak dalı ekler (hedefin altına). */
export function addParallel(program: LadderProgram, targetId: string): { program: LadderProgram; contactId: string | null } {
  const net = networkOf(program, targetId);
  if (!net) return { program, contactId: null };
  const next = idFactory(program);
  const contact: Contact = { kind: 'contact', id: next(), address: '%I0.0', contact: 'NO' };
  const target = targetId === net.id || targetId === net.coil.id ? net.logic.id : targetId;
  const logic = mapNode(net.logic, target, (n) => ({ kind: 'parallel', id: next(), branches: [n, contact] }));
  return {
    program: updateNetwork(program, net.id, (n) => ({ ...n, logic: normalize(logic!) })),
    contactId: contact.id,
  };
}

/** Kontağı siler; network'ün son kontağı silinemez. */
export function removeContact(program: LadderProgram, id: string): LadderProgram {
  const net = networkOf(program, id);
  if (!net || net.logic.id === id) return program;
  const logic = mapNode(net.logic, id, () => null);
  if (!logic) return program;
  return updateNetwork(program, net.id, (n) => ({ ...n, logic: normalize(logic) }));
}

export interface ContactPatch {
  address?: string;
  contact?: ContactType;
  label?: string;
}

export function updateContact(program: LadderProgram, id: string, patch: ContactPatch): LadderProgram {
  const net = networkOf(program, id);
  if (!net) return program;
  const logic = mapNode(net.logic, id, (n) => {
    if (n.kind !== 'contact') return n;
    const out: Contact = { ...n, ...patch };
    if (out.label === '') delete out.label;
    return out;
  });
  return updateNetwork(program, net.id, (n) => ({ ...n, logic: logic! }));
}

export function updateCoil(program: LadderProgram, netId: string, patch: { address?: string; label?: string }): LadderProgram {
  return updateNetwork(program, netId, (n) => {
    const coil = { ...n.coil, ...patch };
    if (coil.label === '') delete coil.label;
    return { ...n, coil };
  });
}
