// Ladder programı üzerinde saf düzenleme işlemleri (editör için). Her işlem yeni bir program
// döndürür; geçersiz işlem (ör. network'ün son kontağını silmek) programı değiştirmeden döndürür.
// Ağaç her işlemden sonra normalize edilir: tek elemanlı seri/paralel grup elemana indirgenir,
// iç içe aynı tür gruplar düzleştirilir.

import { FUNC_COUNT, parseFunc } from './address';
import { BOX_SPECS } from './boxes';
import {
  isBox,
  isCounter,
  isTimer,
  type Coil,
  type CoilType,
  type CompareOp,
  type ContactType,
  type LadderNode,
  type LadderProgram,
  type Network,
} from './ladder';

type Contact = Extract<LadderNode, { kind: 'contact' }>;
type Compare = Extract<LadderNode, { kind: 'compare' }>;
/** Network mantığındaki yaprak eleman: kontak veya karşılaştırma. */
export type Element = Contact | Compare;

/** Yeni eleman şablonu (kimlik ve varsayılan adresler eklenirken verilir). */
export type ElementTemplate = { kind: 'contact'; contact: ContactType } | { kind: 'compare'; op: CompareOp };

const NO_CONTACT: ElementTemplate = { kind: 'contact', contact: 'NO' };

function makeElement(template: ElementTemplate, id: string): Element {
  return template.kind === 'contact'
    ? { kind: 'contact', id, address: '%I0.0', contact: template.contact }
    : { kind: 'compare', id, op: template.op, a: 'C0', b: '5' };
}

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
  if (node.kind === 'contact' || node.kind === 'compare') return node;
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

/** Kimliği verilen kontak veya karşılaştırma elemanı. */
export function findElement(program: LadderProgram, id: string): Element | undefined {
  let found: Element | undefined;
  const visit = (n: LadderNode) => {
    if (n.id === id && (n.kind === 'contact' || n.kind === 'compare')) found = n;
    if (n.kind === 'series') n.items.forEach(visit);
    if (n.kind === 'parallel') n.branches.forEach(visit);
  };
  program.networks.forEach((n) => visit(n.logic));
  return found;
}

export function findContact(program: LadderProgram, id: string): Contact | undefined {
  const el = findElement(program, id);
  return el?.kind === 'contact' ? el : undefined;
}

/** Programda kullanılmayan ilk zamanlayıcı/sayıcı adresi (hepsi doluysa 0). */
export function freeFunc(program: LadderProgram, area: 'T' | 'C'): string {
  const used = new Set(
    program.networks
      .filter((n) => (area === 'T' ? isTimer(n.coil.type) : isCounter(n.coil.type)))
      .map((n) => parseFunc(n.coil.address)?.index),
  );
  for (let i = 0; i < FUNC_COUNT; i++) if (!used.has(i)) return `${area}${i}`;
  return `${area}0`;
}

/** Çıkışı başka türe çevirir; adres ve ön ayar türe uygun değilse varsayılana döner. */
function retype(program: LadderProgram, coil: Coil, type: CoilType): Coil {
  const out: Coil = { id: coil.id, address: coil.address };
  if (type !== 'coil') out.type = type;
  if (coil.label) out.label = coil.label;
  const func = parseFunc(coil.address);
  if (isBox(type)) {
    const spec = BOX_SPECS[type];
    const same = coil.type === type;
    out.address = same ? coil.address : spec.defaultOut;
    out.args = Object.fromEntries(spec.args.map((a) => [a.key, (same && coil.args?.[a.key]) || a.default]));
    return out;
  }
  if (isTimer(type) || isCounter(type)) {
    const area = isTimer(type) ? 'T' : 'C';
    const same = isTimer(type) ? isTimer(coil.type) : isCounter(coil.type);
    out.address = func?.area === area ? coil.address : freeFunc(program, area);
    out.preset = same && coil.preset !== undefined ? coil.preset : isTimer(type) ? 3000 : 5;
    if (type === 'TONR' || type === 'CTU' || type === 'CTUD') out.reset = coil.reset ?? '%I0.1';
    if (type === 'CTD') out.load = coil.load ?? '%I0.1';
    if (type === 'CTUD') out.down = coil.down ?? '%I0.2';
  } else if ((func || /^%?[MQI]W\d+$/i.test(coil.address)) && type !== 'reset') {
    out.address = '%Q0.0';
  }
  return out;
}

/** Network çıkışının türünü değiştirir (bobin, set/reset, zamanlayıcı, sayıcı). */
export function setOutputType(program: LadderProgram, netId: string, type: CoilType): LadderProgram {
  return updateNetwork(program, netId, (n) => ({ ...n, coil: retype(program, n.coil, type) }));
}

/**
 * Sona yeni network ekler: tek elemanlı mantık ve verilen türde çıkış.
 * Zamanlayıcı/sayıcıya boştaki ilk T/C adresi verilir.
 */
export function addNetwork(
  program: LadderProgram,
  output: CoilType = 'coil',
  template: ElementTemplate = NO_CONTACT,
): { program: LadderProgram; contactId: string; coilId: string } {
  const next = idFactory(program);
  const used = new Set(program.networks.map((n) => n.id));
  let k = program.networks.length + 1;
  while (used.has(`N${k}`)) k++;
  const contactId = next();
  const coilId = next();
  const base: Coil = { id: coilId, address: `%Q0.${Math.min(7, program.networks.length)}` };
  const network: Network = {
    id: `N${k}`,
    title: `Network ${k}`,
    logic: makeElement(template, contactId),
    coil: output === 'coil' ? base : retype(program, base, output),
  };
  return { program: { ...program, networks: [...program.networks, network] }, contactId, coilId };
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
 * `targetId` elemanının sağına seri yeni bir eleman ekler. Hedef network'ün kendisiyse
 * eleman bobinin hemen önüne (mantığın sonuna) eklenir.
 */
export function addSeries(
  program: LadderProgram,
  targetId: string,
  template: ElementTemplate = NO_CONTACT,
): { program: LadderProgram; contactId: string | null } {
  const net = networkOf(program, targetId);
  if (!net) return { program, contactId: null };
  const next = idFactory(program);
  const element = makeElement(template, next());
  const target = targetId === net.id || targetId === net.coil.id ? net.logic.id : targetId;
  const logic = mapNode(net.logic, target, (n) => ({ kind: 'series', id: next(), items: [n, element] }));
  return {
    program: updateNetwork(program, net.id, (n) => ({ ...n, logic: normalize(logic!) })),
    contactId: element.id,
  };
}

/** `targetId` elemanına paralel yeni bir eleman dalı ekler (hedefin altına). */
export function addParallel(
  program: LadderProgram,
  targetId: string,
  template: ElementTemplate = NO_CONTACT,
): { program: LadderProgram; contactId: string | null } {
  const net = networkOf(program, targetId);
  if (!net) return { program, contactId: null };
  const next = idFactory(program);
  const element = makeElement(template, next());
  const target = targetId === net.id || targetId === net.coil.id ? net.logic.id : targetId;
  const logic = mapNode(net.logic, target, (n) => ({ kind: 'parallel', id: next(), branches: [n, element] }));
  return {
    program: updateNetwork(program, net.id, (n) => ({ ...n, logic: normalize(logic!) })),
    contactId: element.id,
  };
}

/** Kontağı veya karşılaştırmayı siler; network'ün son elemanı silinemez. */
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

export interface ComparePatch {
  op?: CompareOp;
  a?: string;
  b?: string;
  label?: string;
}

export function updateContact(program: LadderProgram, id: string, patch: ContactPatch | ComparePatch): LadderProgram {
  const net = networkOf(program, id);
  if (!net) return program;
  const logic = mapNode(net.logic, id, (n) => {
    if (n.kind !== 'contact' && n.kind !== 'compare') return n;
    const out = { ...n, ...patch } as Element;
    if (out.label === '') delete out.label;
    return out;
  });
  return updateNetwork(program, net.id, (n) => ({ ...n, logic: logic! }));
}

export type CoilPatch = Partial<Pick<Coil, 'address' | 'label' | 'preset' | 'reset' | 'load' | 'down' | 'args'>>;

export function updateCoil(program: LadderProgram, netId: string, patch: CoilPatch): LadderProgram {
  return updateNetwork(program, netId, (n) => {
    const coil = { ...n.coil, ...patch };
    for (const key of ['label', 'reset', 'load', 'down'] as const) if (coil[key] === '') delete coil[key];
    return { ...n, coil };
  });
}

// --- Komut kütüphanesinden ekleme ----------------------------------------------------------

/** Kütüphanedeki bir komut: mantığa eklenen eleman veya network çıkışı. */
export type InstructionAction = { kind: 'element'; template: ElementTemplate } | { kind: 'output'; type: CoilType };

/**
 * Komutu programa ekler. Eleman: seçilenin sağına seri (`parallel` ise altına paralel);
 * seçim yoksa son network'ün sonuna, network yoksa yeni network'e. Çıkış: seçilen network'ün
 * çıkışı bu türe çevrilir; seçim yoksa bu çıkışla yeni network eklenir.
 * `selectId` editörde seçilecek elemandır.
 */
export function insertInstruction(
  program: LadderProgram,
  selected: string | null,
  action: InstructionAction,
  parallel = false,
): { program: LadderProgram; selectId: string | null } {
  const owner = selected ? networkOf(program, selected) : undefined;
  if (action.kind === 'output') {
    if (owner) return { program: setOutputType(program, owner.id, action.type), selectId: owner.coil.id };
    const r = addNetwork(program, action.type);
    return { program: r.program, selectId: r.coilId };
  }
  const net = owner ?? program.networks.at(-1);
  if (!net) {
    const r = addNetwork(program, 'coil', action.template);
    return { program: r.program, selectId: r.contactId };
  }
  const target = selected && findElement(program, selected) ? selected : net.id;
  const r = (parallel ? addParallel : addSeries)(program, target, action.template);
  return { program: r.program, selectId: r.contactId };
}
