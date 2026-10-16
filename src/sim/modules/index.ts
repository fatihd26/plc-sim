// Bileşen modülleri kaydı. Yeni bir bileşen eklemek için:
//   1. modules/<ad>.ts içinde defineModule ile tanımla (spec + kancalar + state)
//   2. aşağıdaki MODULES listesine ekle
//   3. UI'da src/ui/devices/<ad>.tsx içinde çizimini (geometri + gövde) tanımla ve
//      src/ui/devices/index.ts'e ekle
// Katalog, simülasyon, kütüphane, özellikler paneli, trend ve görev senaryoları bileşeni
// buradan otomatik tanır.

import { levelTxModule, potentiometerModule, pressureTxModule, tempTxModule } from './analog';
import { conveyorModule } from './conveyor';
import { cylinderModule } from './cylinder';
import { brakeMotorModule, motor6Module, vfdModule } from './drives';
import { fanModule } from './fan';
import { excavatorModule, hpuModule, hydCylinderModule, valve43Module } from './hydraulics';
import {
  airSupplyModule,
  cylDoubleModule,
  cylSingleModule,
  throttleModule,
  valve32Module,
  valve52biModule,
  valve52Module,
  valve53Module,
} from './pneumatics';
import { furnaceModule, processTankModule } from './process';
import { pumpModule } from './pump';
import { elevatorModule, garageDoorModule, linearAxisModule, pickPlaceModule, robotArmModule } from './robotics';
import { capacitiveModule, encoderModule, inductiveModule, limitSwitchModule, photoModule } from './sensors';
import { parkingBarrierModule } from './parking';
import { pedCrossingModule, trafficJunctionModule, trafficLightModule } from './traffic';
import type { DeviceModule } from './types';

export const MODULES = [
  // Komuta / sensörler
  potentiometerModule,
  limitSwitchModule,
  inductiveModule,
  capacitiveModule,
  photoModule,
  encoderModule,
  levelTxModule,
  tempTxModule,
  pressureTxModule,
  // Tüketiciler ve sürücüler
  motor6Module,
  brakeMotorModule,
  vfdModule,
  // Mekanik
  cylinderModule,
  conveyorModule,
  fanModule,
  pumpModule,
  // Proses
  processTankModule,
  furnaceModule,
  // Pnömatik
  airSupplyModule,
  valve52Module,
  valve52biModule,
  valve53Module,
  valve32Module,
  throttleModule,
  cylDoubleModule,
  cylSingleModule,
  // Hidrolik
  hpuModule,
  valve43Module,
  hydCylinderModule,
  excavatorModule,
  // Robotik
  linearAxisModule,
  pickPlaceModule,
  robotArmModule,
  elevatorModule,
  garageDoorModule,
  // Sahneler
  trafficLightModule,
  pedCrossingModule,
  trafficJunctionModule,
  parkingBarrierModule,
] as const;

export type AnyModule = (typeof MODULES)[number];
export type ModuleType = AnyModule['spec']['type'];
export type ModuleState = ReturnType<AnyModule['state']>;

const BY_TYPE = new Map<string, DeviceModule<string, unknown, { type: string }>>(
  MODULES.map((m) => [m.spec.type, m as unknown as DeviceModule<string, unknown, { type: string }>]),
);

/** Tipin modülü (çekirdek tiplerde undefined). */
export function moduleOf(type: string): DeviceModule<string, unknown, { type: string }> | undefined {
  return BY_TYPE.get(type);
}

export type { DeviceModule } from './types';
