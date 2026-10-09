import type { LadderProgram } from './ladder';

/**
 * Start-stop mühürleme (self-holding).
 * Stop (S2) ve termik (F2 95-96) sahada NC bağlıdır; bu yüzden programda NO kontak
 * olarak kullanılır. Kablo koparsa giriş 0 olur ve motor durur (fail-safe).
 *
 *   %I0.0 S1      %I0.1 S2   %I0.2 F2        %Q0.0 K1
 * ──┬──| |──┬─────| |────────| |──────────────( )──
 *   │ %Q0.0 │
 *   └──| |──┘
 */
export const startStopProgram: LadderProgram = {
  networks: [
    {
      id: 'N1',
      title: 'Motor M1 start-stop (mühürleme)',
      logic: {
        kind: 'series',
        id: 'N1.s',
        items: [
          {
            kind: 'parallel',
            id: 'N1.p',
            branches: [
              { kind: 'contact', id: 'N1.start', address: '%I0.0', contact: 'NO', label: 'S1 Start' },
              { kind: 'contact', id: 'N1.hold', address: '%Q0.0', contact: 'NO', label: 'K1 Mühür' },
            ],
          },
          { kind: 'contact', id: 'N1.stop', address: '%I0.1', contact: 'NO', label: 'S2 Stop' },
          { kind: 'contact', id: 'N1.ovl', address: '%I0.2', contact: 'NO', label: 'F2 Termik' },
        ],
      },
      coil: { id: 'N1.coil', address: '%Q0.0', label: 'K1 Kontaktör' },
    },
  ],
};
