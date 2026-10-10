import { startStopProgram } from './programs';
import type { Schematic, Wire } from './schematic';

let n = 0;
const w = (a: string, b: string): Wire => {
  const [ac, at] = a.split(':') as [string, string];
  const [bc, bt] = b.split(':') as [string, string];
  return { id: `w${++n}`, a: { component: ac, terminal: at }, b: { component: bc, terminal: bt } };
};

/**
 * Start-stop mühürleme devresi.
 * Güç: X1 → K1 ana kontaklar → F2 termik → M1.
 * Kumanda: G1 24 V → S1 (NO) / S2 (NC) / F2 95-96 → PLC girişleri; Q0.0 → K1 bobini.
 */
export function startStopSchematic(): Schematic {
  n = 0;
  return {
    version: 2,
    title: 'Start-stop örneği',
    pages: [{ id: 'p1', title: 'Güç ve kumanda devresi' }],
    components: [
      { id: 'X1', type: 'mains3', name: 'X1', x: 40, y: 40, rotation: 0 },
      { id: 'K1', type: 'contactor', name: 'K1', x: 40, y: 160, rotation: 0 },
      { id: 'F2', type: 'thermal', name: 'F2', x: 40, y: 300, rotation: 0 },
      { id: 'M1', type: 'motor3', name: 'M1', x: 40, y: 440, rotation: 0 },
      { id: 'G1', type: 'psu24', name: 'G1', x: 300, y: 20, rotation: 0 },
      { id: 'S1', type: 'buttonNO', name: 'S1', x: 380, y: 140, rotation: 0 },
      { id: 'S2', type: 'buttonNC', name: 'S2', x: 460, y: 140, rotation: 0 },
      { id: 'A1', type: 'plc', name: 'A1', x: 340, y: 280, rotation: 0, program: structuredClone(startStopProgram) },
    ],
    wires: [
      // Güç devresi
      w('X1:L1', 'K1:1'),
      w('X1:L2', 'K1:3'),
      w('X1:L3', 'K1:5'),
      w('K1:2', 'F2:1'),
      w('K1:4', 'F2:3'),
      w('K1:6', 'F2:5'),
      w('F2:2', 'M1:U'),
      w('F2:4', 'M1:V'),
      w('F2:6', 'M1:W'),
      // PLC beslemesi
      w('G1:L+', 'A1:L+'),
      w('G1:M', 'A1:M'),
      // Girişler
      w('G1:L+', 'S1:13'),
      w('S1:13', 'S2:11'),
      w('S1:14', 'A1:I0.0'),
      w('S2:12', 'A1:I0.1'),
      w('G1:L+', 'F2:95'),
      w('F2:96', 'A1:I0.2'),
      // Çıkış
      w('A1:Q0.0', 'K1:A1'),
      w('K1:A2', 'G1:M'),
    ],
  };
}
