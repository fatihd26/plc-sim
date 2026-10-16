// Cihaz görünümleri kaydı (bkz. src/sim/modules/index.ts). Her çekirdek modülün burada bir
// görünümü olmalıdır; editor.test.ts eksik veya terminalleri uyuşmayan görünümleri yakalar.

import { brakeMotorView, motor6View, vfdView } from './drives';
import {
  airSupplyView,
  cylDoubleView,
  cylSingleView,
  excavatorView,
  hpuView,
  hydCylinderView,
  throttleView,
  valve32View,
  valve43View,
  valve52biView,
  valve52View,
  valve53View,
} from './fluid';
import { conveyorView, cylinderView, fanView, pumpView } from './mechanics';
import { furnaceView, processTankView } from './process';
import { elevatorView, garageDoorView, linearAxisView, pickPlaceView, robotArmView } from './robotics';
import {
  capacitiveView,
  encoderView,
  inductiveView,
  levelTxView,
  limitSwitchView,
  photoView,
  potentiometerView,
  pressureTxView,
  tempTxView,
} from './sensors';
import { pedCrossingView, trafficJunctionView, trafficLightView } from './traffic';
import type { AnyView } from './types';

export const VIEWS: AnyView[] = [
  potentiometerView,
  limitSwitchView,
  inductiveView,
  capacitiveView,
  photoView,
  encoderView,
  levelTxView,
  tempTxView,
  pressureTxView,
  motor6View,
  brakeMotorView,
  vfdView,
  cylinderView,
  conveyorView,
  fanView,
  pumpView,
  processTankView,
  furnaceView,
  airSupplyView,
  valve52View,
  valve52biView,
  valve53View,
  valve32View,
  throttleView,
  cylDoubleView,
  cylSingleView,
  hpuView,
  valve43View,
  hydCylinderView,
  excavatorView,
  linearAxisView,
  pickPlaceView,
  robotArmView,
  elevatorView,
  garageDoorView,
  trafficLightView,
  pedCrossingView,
  trafficJunctionView,
];

const BY_TYPE = new Map(VIEWS.map((v) => [v.type, v]));

export function viewOf(type: string): AnyView | undefined {
  return BY_TYPE.get(type);
}
