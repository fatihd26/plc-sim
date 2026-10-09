import { describe, expect, it } from 'vitest';
import { NetSolver } from './netlist';

describe('NetSolver', () => {
  it('bağlı terminaller aynı nete düşer ve potansiyeli paylaşır', () => {
    const n = new NetSolver(5);
    n.connect(0, 1);
    n.connect(1, 2);
    n.addSource(0, 'P24');
    const r = n.solve();
    expect(r.netOf(2)).toBe(r.netOf(0));
    expect(r.potential(2)).toBe('P24');
    expect(r.potential(3)).toBeNull();
    expect(r.shorts).toEqual([]);
  });

  it('farklı potansiyeller aynı nette kısa devredir', () => {
    const n = new NetSolver(4);
    n.addSource(0, 'P24');
    n.addSource(3, 'M0');
    n.connect(0, 1);
    n.connect(2, 3);
    expect(n.solve().shorts).toEqual([]);
    n.connect(1, 2);
    const r = n.solve();
    expect(r.potential(1)).toBe('short');
    expect(r.shorts).toEqual([[0, 1, 2, 3]]);
  });

  it('aynı terminale iki kaynak eklenirse ikisi de dikkate alınır', () => {
    const n = new NetSolver(1);
    n.addSource(0, 'L1');
    n.addSource(0, 'L2');
    expect(n.solve().potential(0)).toBe('short');
  });

  it('reset tüm bağlantıları ve kaynakları temizler', () => {
    const n = new NetSolver(2);
    n.connect(0, 1);
    n.addSource(0, 'L1');
    n.reset();
    const r = n.solve();
    expect(r.netOf(1)).toBe(1);
    expect(r.potential(0)).toBeNull();
  });
});
