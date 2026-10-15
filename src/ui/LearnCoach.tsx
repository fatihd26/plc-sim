// Eğitim kartı: açık dersin adımlarını veya görevin metnini çizim alanının üstünde gösterir.
// Ders adımlarındaki `done` koşulu canlı durumdan (şema, simülasyon, panel) okunur; adım
// tamamlanınca "İleri" açılır. Görevde "Kontrol et" senaryoyu koşturur, geçince görev tamamlanır.

import { useEffect, useState } from 'react';
import type { Item, Lesson, StepContext, TaskItem } from '../learn/curriculum';
import { locate } from '../learn/curriculum';
import { runScenario, type ScenarioResult } from '../sim/scenario';
import { TASKS } from '../sim/tasks';

interface Props {
  item: Lesson | TaskItem;
  step: number;
  ctx: StepContext;
  done: boolean;
  attempts: number;
  next: Item | null;
  onStep(step: number): void;
  /** Ders bitti veya görev geçti. */
  onComplete(): void;
  /** Görevde "Kontrol et" sayısı. */
  onAttempt(): void;
  onNext(): void;
  onHome(): void;
  onClose(): void;
  onShowPanel(tab: 'plc' | 'task'): void;
}

export function LearnCoach(props: Props) {
  const { item } = props;
  const [min, setMin] = useState(false);
  const where = locate(item.id);
  const levelItems = where?.level.items.filter((i) => i.kind !== 'soon') ?? [];
  const pos = levelItems.findIndex((i) => i.id === item.id);

  return (
    <aside className={`learn-coach${min ? ' min' : ''}`} aria-label="Eğitim">
      <header className="coach-head">
        <button type="button" className="coach-crumb" title="Eğitim yolunu aç" onClick={props.onHome}>
          🎓 {where?.level.title} · {pos + 1}/{levelItems.length}
        </button>
        <span className="coach-actions">
          <button type="button" className="icon" aria-label={min ? 'Genişlet' : 'Küçült'} onClick={() => setMin(!min)}>
            {min ? '▾' : '▴'}
          </button>
          <button type="button" className="icon" aria-label="Eğitimden çık" title="Eğitimden çık (ilerleme saklanır)" onClick={props.onClose}>
            ✕
          </button>
        </span>
      </header>
      <h3 className="coach-title">
        {item.kind === 'task' ? (item.exit ? '🏁 Çıkış görevi: ' : '🛠 Görev: ') : '📖 '}
        {item.title}
        {props.done && <span className="coach-done"> ✔</span>}
      </h3>
      {!min && (item.kind === 'lesson' ? <LessonBody {...props} item={item} /> : <TaskBody {...props} item={item} />)}
    </aside>
  );
}

function LessonBody(props: Props & { item: Lesson }) {
  const { item, ctx } = props;
  const step = Math.min(props.step, item.steps.length - 1);
  const s = item.steps[step]!;
  // Adım bir kez tamamlandıysa sonradan durum değişse de tamam sayılır.
  const [reached, setReached] = useState<Set<number>>(() => new Set());
  useEffect(() => setReached(new Set()), [item.id]);
  const now = s.done ? s.done(ctx) : true;
  useEffect(() => {
    if (now && !reached.has(step)) setReached((r) => new Set(r).add(step));
  }, [now, step, reached]);
  const ok = now || reached.has(step);
  const last = step === item.steps.length - 1;

  return (
    <div className="coach-body">
      <ol className="coach-dots" aria-label={`Adım ${step + 1} / ${item.steps.length}`}>
        {item.steps.map((_, i) => (
          <li key={i} className={i < step ? 'past' : i === step ? 'current' : ''} />
        ))}
      </ol>
      <p className="coach-text">{s.text}</p>
      {s.todo && (
        <p className={`coach-todo ${ok ? 'ok' : 'wait'}`}>
          <span aria-hidden>{ok ? '✔' : '◌'}</span> {s.todo}
          {!ok && <span className="muted"> · yapınca adım tamamlanır</span>}
        </p>
      )}
      <div className="coach-nav">
        <button type="button" disabled={step === 0} onClick={() => props.onStep(step - 1)}>
          ‹ Geri
        </button>
        {!ok && (
          <button type="button" className="link small" onClick={() => props.onStep(step + 1 < item.steps.length ? step + 1 : step)} disabled={last}>
            Adımı atla
          </button>
        )}
        {last ? (
          props.done ? (
            <NextButton {...props} />
          ) : (
            <button type="button" className="primary" disabled={!ok} onClick={props.onComplete}>
              Dersi bitir ✔
            </button>
          )
        ) : (
          <button type="button" className="primary" disabled={!ok} onClick={() => props.onStep(step + 1)}>
            İleri ›
          </button>
        )}
      </div>
    </div>
  );
}

function TaskBody(props: Props & { item: TaskItem }) {
  const { item, ctx } = props;
  const def = TASKS.find((t) => t.id === item.taskId);
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setResult(null), [item.id]);
  if (!def) return <p className="coach-text">Görev bulunamadı: {item.taskId}</p>;
  const hasPlc = ctx.schematic.components.some((c) => c.type === 'plc' || c.type === 'esp32');

  const run = () => {
    setBusy(true);
    setResult(null);
    props.onAttempt();
    setTimeout(() => {
      const r = runScenario(ctx.schematic, def.task.scenario);
      setResult(r);
      setBusy(false);
      if (r.ok) props.onComplete();
    }, 30);
  };
  const fail = result?.steps.find((s) => s.status === 'fail');

  return (
    <div className="coach-body">
      <p className="coach-text pre">{def.task.text}</p>
      <details className="coach-hint">
        <summary>İpucu</summary>
        <p>{item.hint}</p>
      </details>
      <p className="muted small">
        {hasPlc ? 'Programı alttaki PLC panelinde yaz' : 'Kabloları Düzenle modunda çiz'}, sonra Kontrol et. Kontrol, çözümünü ayrı
        bir simülasyonda senaryo adımlarıyla dener.
      </p>
      {result && (
        <div className={`task-result ${result.ok ? 'ok' : 'fail'}`}>
          {result.error ? (
            <p>
              <strong>Senaryo çalıştırılamadı:</strong> {result.error}
            </p>
          ) : result.ok ? (
            <p>
              <strong>✔ Görev başarılı</strong> · {result.passed}/{result.total} denetim geçti
            </p>
          ) : (
            <p>
              <strong>✘ Henüz olmadı</strong> · {result.passed}/{result.total} denetim geçti
              {fail && (
                <>
                  <br />
                  Takıldığı adım: <span className="mono">{fail.text}</span>
                  {fail.message && <span className="muted"> ({fail.message})</span>}
                </>
              )}
            </p>
          )}
        </div>
      )}
      <div className="coach-nav">
        {hasPlc && (
          <button type="button" onClick={() => props.onShowPanel('plc')}>
            Programı aç
          </button>
        )}
        <button type="button" onClick={() => props.onShowPanel('task')} title="Senaryonun tüm adımları alttaki Görev sekmesinde">
          Ayrıntı
        </button>
        <button type="button" className={props.done ? '' : 'primary'} disabled={busy} onClick={run}>
          {busy ? 'Denetleniyor…' : '✓ Kontrol et'}
        </button>
        {props.done && <NextButton {...props} />}
      </div>
      {props.attempts > 0 && <p className="muted small coach-attempts">{props.attempts} deneme</p>}
    </div>
  );
}

function NextButton(props: Props) {
  return props.next ? (
    <button type="button" className="primary" onClick={props.onNext}>
      Sıradaki: {props.next.title} ›
    </button>
  ) : (
    <button type="button" className="primary" onClick={props.onHome}>
      Eğitim yolu ›
    </button>
  );
}
