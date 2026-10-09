import type { ComponentState } from '../sim/simulation';

type MotorState = Extract<ComponentState, { type: 'motor3' }>;

/** Motor: dönen fan kanatları ve mil işaretiyle basit animasyon. */
export function MotorView({ motor, name }: { motor: MotorState; name: string }) {
  const cls = motor.powered ? 'motor-view powered' : motor.running ? 'motor-view coasting' : 'motor-view';
  return (
    <div className={cls}>
      <svg viewBox="0 0 240 160" width="100%" role="img" aria-label={`Motor ${name}`}>
        {/* gövde */}
        <rect x="40" y="35" width="120" height="90" rx="10" className="motor-body" />
        {[50, 65, 80, 95, 110].map((y) => (
          <line key={y} x1="48" x2="152" y1={y + 5} y2={y + 5} className="fin" />
        ))}
        <rect x="70" y="125" width="60" height="12" className="motor-foot" />
        <text x="100" y="28" className="motor-name">
          {name} 3~
        </text>
        {/* mil ve kaplin diski */}
        <rect x="160" y="74" width="30" height="12" className="shaft" />
        <g transform={`rotate(${motor.angleDeg} 205 80)`}>
          <circle cx="205" cy="80" r="26" className="disc" />
          {[0, 120, 240].map((a) => (
            <path
              key={a}
              d="M 205 80 L 205 57 A 23 23 0 0 1 223 66 Z"
              transform={`rotate(${a} 205 80)`}
              className="blade"
            />
          ))}
          <circle cx="205" cy="80" r="4" className="hub" />
        </g>
      </svg>
      <dl className="readout">
        <div>
          <dt>Hız</dt>
          <dd>{motor.rpm.toFixed(0)} dev/dk</dd>
        </div>
        <div>
          <dt>Akım</dt>
          <dd>{motor.currentA.toFixed(2)} A</dd>
        </div>
        <div>
          <dt>Durum</dt>
          <dd>{motor.powered ? 'Enerjili' : motor.running ? 'Yavaşlıyor' : 'Duruyor'}</dd>
        </div>
      </dl>
    </div>
  );
}
