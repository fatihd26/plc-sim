// Görev paneli: görev metni ve otomatik denetim. Düzenleme modunda öğretmen görevi ve senaryoyu
// yazar; her iki modda da "Kontrol et" senaryoyu ayrı, hızlı bir simülasyonda koşturur ve satır
// satır sonucu gösterir (canlı simülasyonu etkilemez).

import { useEffect, useState } from 'react';
import { runScenario, type ScenarioResult } from '../sim/scenario';
import type { Schematic, Task } from '../sim/schematic';
import type { EditorAction } from './editor/document';

const TEMPLATE: Task = {
  title: 'Yeni görev',
  text: 'Görevi buraya yazın: hangi butona basılınca ne olmalı, hangi sensör neyi durdurmalı...',
  scenario: [
    '# Her satır bir adım. Komutlar: bas, bırak, tıkla, aç, kapat, eylem, arıza, onar, kopar, bağla, bekle, kontrol',
    'tıkla S1',
    'bekle K1.kontak en fazla 2 s',
    'kontrol K1.kontak boyunca 1 s',
  ].join('\n'),
};

const HELP = [
  ['bas S1 / bırak S1', 'butona bas / bırak'],
  ['tıkla S1 [200 ms]', 'bas, bekle, bırak'],
  ['aç Q1 / kapat Q1', 'şalter, sigorta'],
  ['eylem M1 addBox [değer]', 'bileşen eylemi (kutu koy, engel, ayar...)'],
  ['arıza K1 coil / onar K1 coil', 'arıza enjekte et / kaldır'],
  ['bekle 2 s', 'süre kadar ilerle'],
  ['bekle <koşul> en fazla 5 s', 'koşulu bekle'],
  ['kontrol <koşul> [boyunca 2 s]', 'denetle (puanlanır)'],
  ['koşul', 'K1.kontak, değil P1.yanik, T1.seviye >= 45 ve %Q0.0 = 1'],
];

interface Props {
  schematic: Schematic;
  edit: boolean;
  dispatch(action: EditorAction): void;
}

export function TaskPanel({ schematic, edit, dispatch }: Props) {
  const task = schematic.task;
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Task | null>(null);
  useEffect(() => {
    setResult(null);
    setDraft(null);
  }, [schematic.task, schematic.title]);

  const run = () => {
    if (!task) return;
    setBusy(true);
    setResult(null);
    // Arayüz "denetleniyor" durumunu çizebilsin diye bir sonraki karede çalıştır.
    setTimeout(() => {
      setResult(runScenario(schematic, task.scenario));
      setBusy(false);
    }, 30);
  };

  if (!task) {
    return (
      <div className="task-panel">
        <p className="dock-note">
          Bu projede görev yok. Görev, öğrencinin programını otomatik denetleyen bir senaryodur.
          {edit ? ' Aşağıdan bir görev ekleyin veya Örnek ▾ › Görevler menüsünden hazır bir görev açın.' : ' Örnek ▾ › Görevler menüsünden hazır bir görev açın.'}
        </p>
        {edit && (
          <div className="btn-row">
            <button type="button" className="primary" onClick={() => dispatch({ type: 'setTask', task: TEMPLATE })}>
              Görev ekle
            </button>
          </div>
        )}
      </div>
    );
  }

  const cur = draft ?? task;
  const commit = (patch: Partial<Task>) => {
    const next = { ...cur, ...patch };
    setDraft(next);
  };
  const save = () => {
    if (draft) dispatch({ type: 'setTask', task: draft });
  };

  return (
    <div className="task-panel">
      <div className="task-text">
        {edit ? (
          <>
            <input className="task-title" value={cur.title} onChange={(e) => commit({ title: e.target.value })} onBlur={save} />
            <textarea rows={4} value={cur.text} onChange={(e) => commit({ text: e.target.value })} onBlur={save} />
          </>
        ) : (
          <>
            <h3>{task.title}</h3>
            <p className="task-body">{task.text}</p>
          </>
        )}
        <div className="btn-row">
          <button type="button" className="primary" disabled={busy} onClick={run}>
            {busy ? 'Denetleniyor…' : '✓ Kontrol et'}
          </button>
          {edit && (
            <button type="button" className="danger" onClick={() => dispatch({ type: 'setTask', task: undefined })}>
              Görevi kaldır
            </button>
          )}
        </div>
        {result && <ResultView result={result} />}
      </div>
      <div className="task-scenario">
        {edit ? (
          <>
            <label className="small muted">Denetim senaryosu (öğrenci programı bu adımlarla test edilir)</label>
            <textarea className="mono" rows={10} spellCheck={false} value={cur.scenario} onChange={(e) => commit({ scenario: e.target.value })} onBlur={save} />
            <details>
              <summary>Senaryo dili</summary>
              <table className="terms">
                <tbody>
                  {HELP.map(([cmd, what]) => (
                    <tr key={cmd}>
                      <td className="mono">{cmd}</td>
                      <td>{what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted small">Sinyal adları Özellikler › Sinyaller tablosunda görünür (ör. M1.calisiyor, T1.seviye).</p>
            </details>
          </>
        ) : (
          <details>
            <summary>Denetim adımları</summary>
            <pre className="mono small">{task.scenario}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: ScenarioResult }) {
  if (result.error) {
    return (
      <p className="task-result fail">
        <strong>Senaryo çalıştırılamadı:</strong> {result.error}
      </p>
    );
  }
  return (
    <div className={`task-result ${result.ok ? 'ok' : 'fail'}`}>
      <p>
        <strong>{result.ok ? '✔ Görev başarılı' : '✘ Görev tamamlanmadı'}</strong> · {result.passed}/{result.total} denetim geçti
      </p>
      <ol className="task-steps">
        {result.steps.map((s) => (
          <li key={s.line} className={s.status}>
            <span className="mark" aria-hidden>
              {s.status === 'ok' ? '✔' : s.status === 'fail' ? '✘' : s.status === 'skip' ? '–' : '·'}
            </span>
            <span className="mono">{s.text}</span>
            <span className="muted small">
              {(s.timeMs / 1000).toFixed(2)} s{s.message ? ` · ${s.message}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
