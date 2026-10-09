// Mantıksal bağlantı çözücü (MNA değil).
// Kablolar ve kapalı iç kontaklar terminalleri union-find ile aynı nete birleştirir;
// kaynaklar netlere potansiyel etiketi verir. Bir nette iki farklı etiket = kısa devre.

export type Potential = 'P24' | 'M0' | 'L1' | 'L2' | 'L3';
export type NetPotential = Potential | 'short' | null;

export interface NetResult {
  /** Terminal indeksi → net (kök) indeksi. */
  netOf(terminal: number): number;
  /** Terminalin bulunduğu netin potansiyeli; kısa devre netinde 'short'. */
  potential(terminal: number): NetPotential;
  /** Kısa devre olan netlerin terminal indeksleri (net başına bir dizi). */
  shorts: number[][];
}

export class NetSolver {
  private readonly parent: Int32Array;
  private readonly sources: (Potential | null)[];
  private readonly extraSources: [number, Potential][] = [];

  constructor(readonly size: number) {
    this.parent = new Int32Array(size);
    this.sources = new Array<Potential | null>(size).fill(null);
    this.reset();
  }

  reset(): void {
    for (let i = 0; i < this.size; i++) this.parent[i] = i;
    this.sources.fill(null);
    this.extraSources.length = 0;
  }

  private find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    // Yol sıkıştırma
    while (this.parent[i] !== r) {
      const next = this.parent[i]!;
      this.parent[i] = r;
      i = next;
    }
    return r;
  }

  connect(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    // Deterministik kök seçimi: küçük indeks kök olur.
    if (ra < rb) this.parent[rb] = ra;
    else if (rb < ra) this.parent[ra] = rb;
  }

  addSource(terminal: number, p: Potential): void {
    if (this.sources[terminal] === null) this.sources[terminal] = p;
    else this.extraSources.push([terminal, p]);
  }

  solve(): NetResult {
    const netPot = new Map<number, NetPotential>();
    const add = (terminal: number, p: Potential) => {
      const root = this.find(terminal);
      const cur = netPot.get(root);
      if (cur === undefined || cur === null) netPot.set(root, p);
      else if (cur !== p) netPot.set(root, 'short');
    };
    for (let i = 0; i < this.size; i++) {
      const p = this.sources[i];
      if (p) add(i, p);
    }
    for (const [t, p] of this.extraSources) add(t, p);

    const roots = new Int32Array(this.size);
    const shortMembers = new Map<number, number[]>();
    for (let i = 0; i < this.size; i++) {
      const r = this.find(i);
      roots[i] = r;
      if (netPot.get(r) === 'short') {
        let list = shortMembers.get(r);
        if (!list) shortMembers.set(r, (list = []));
        list.push(i);
      }
    }

    return {
      netOf: (t) => roots[t]!,
      potential: (t) => netPot.get(roots[t]!) ?? null,
      shorts: [...shortMembers.values()],
    };
  }
}
