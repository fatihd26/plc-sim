# PLC Simülatörü – Dikey Prototip

Start-stop mühürleme devresi: S1/S2 butonları → PLC (scan-cycle, process image) →
K1 kontaktör → M1 motor, F2 termik koruma.

```
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest birim + entegrasyon testleri
npm run build      # tip kontrolü + üretim derlemesi
```

## Yapı

```
src/sim/   Simülasyon çekirdeği (saf TS; React/DOM/Math.random/Date.now yasak — purity.test.ts denetler)
  address.ts      %I/%Q/%M bit adresleme
  ladder.ts       Ladder modeli (seri/paralel ağaç), derleme, güç akışı değerlendirme
  plc.ts          Terminaller, process image (PII/PIQ/M), scan()
  devices.ts      PushButton, Contactor, ThermalRelay, Motor
  programs.ts     Start-stop mühürleme programı
  simulation.ts   1 ms tick, faz sırası, komut kuyruğu, snapshot, replay
src/ui/    React katmanı (çekirdeğe yalnız komut gönderir, snapshot okur)
```

## Kablolama (sabit)

| Terminal | Saha cihazı |
|---|---|
| %I0.0 | S1 Start (NO) |
| %I0.1 | S2 Stop (NC) |
| %I0.2 | F2 termik 95-96 (NC) |
| %Q0.0 | K1 bobini |
