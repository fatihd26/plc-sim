// Eğitim yolu ekranı: 5 seviye, her seviyenin dersleri ve görevleri, ilerleme ve "Devam et".
// Seviye, önceki seviyenin çıkış senaryosu geçilince açılır (progress.ts › levelUnlocked).

import { useEffect, useRef } from 'react';
import { LEVELS, locate, type Item } from '../learn/curriculum';
import { counts, isDone, levelUnlocked, nextItem, PROGRESS_EXTENSION, type Progress } from '../learn/progress';

interface Props {
  progress: Progress;
  onOpen(item: Item): void;
  onClose(): void;
  onSave(): void;
  onLoad(file: File): void;
}

const kindLabel = (i: Item) => (i.kind === 'lesson' ? 'Ders' : i.kind === 'task' ? 'Görev' : i.what === 'ders' ? 'Ders' : 'Görev');

export function LearnHome({ progress, onOpen, onClose, onSave, onLoad }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  // Yarım kalan öğe varsa ona, yoksa sıradaki tamamlanmamış öğeye devam edilir.
  const cur = progress.current && locate(progress.current.item)?.item;
  const next = cur && cur.kind !== 'soon' && !isDone(progress, cur.id) ? cur : nextItem(progress);
  const total = counts(progress);
  const started = total.done > 0 || !!progress.current;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="learn-overlay" role="dialog" aria-modal="true" aria-labelledby="learn-title">
      <div className="learn-home">
        <header className="learn-head">
          <div>
            <h2 id="learn-title">Öğren: PLC eğitim yolu</h2>
            <p className="muted">
              5 seviye. Her seviye dersler ve görevlerden oluşur; son görev çıkış senaryosudur, onu geçince sonraki
              seviye açılır.
            </p>
          </div>
          <button type="button" className="icon learn-close" aria-label="Kapat" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="learn-continue">
          <div className="learn-meter" aria-label={`${total.done} / ${total.total} tamamlandı`}>
            <div className="learn-meter-fill" style={{ width: `${(100 * total.done) / Math.max(1, total.total)}%` }} />
          </div>
          <span className="muted small">
            {total.done} / {total.total} tamamlandı
          </span>
          {next ? (
            <button type="button" className="primary learn-go" onClick={() => onOpen(next)}>
              {started ? 'Devam et' : 'Başla'}: {next.title} ›
            </button>
          ) : (
            <strong className="learn-finished">Açık olan her şeyi tamamladın.</strong>
          )}
        </div>

        <ol className="learn-levels">
          {LEVELS.map((level, li) => {
            const open = levelUnlocked(progress, li);
            const c = counts(progress, level);
            const prevExit = li > 0 ? LEVELS[li - 1]!.items.find((i) => 'exit' in i && i.exit) : undefined;
            return (
              <li key={level.id} className={`learn-level${open ? '' : ' locked'}`}>
                <header>
                  <span className="learn-level-no">{li + 1}</span>
                  <div>
                    <h3>
                      {level.title} <span className="muted">· {level.topic}</span>
                    </h3>
                    <p className="muted small">{level.goal}</p>
                  </div>
                  <span className="learn-level-count small">
                    {open ? `${c.done}/${c.total}` : '🔒'}
                  </span>
                </header>
                {!open && prevExit && <p className="small learn-lock-note">Açmak için önce “{prevExit.title}” çıkış görevini geç.</p>}
                <ul className="learn-items">
                  {level.items.map((item) => {
                    const done = isDone(progress, item.id);
                    const soon = item.kind === 'soon';
                    const isNext = next?.id === item.id;
                    const exit = 'exit' in item && item.exit;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`learn-item${done ? ' done' : ''}${isNext ? ' next' : ''}${exit ? ' exit' : ''}`}
                          disabled={!open || soon}
                          onClick={() => onOpen(item)}
                        >
                          <span className="learn-item-mark" aria-hidden>
                            {done ? '✔' : soon ? '·' : exit ? '🏁' : item.kind === 'lesson' ? '📖' : '🛠'}
                          </span>
                          <span className="learn-item-title">{item.title}</span>
                          <span className="learn-item-kind small">
                            {soon ? 'Yakında' : exit ? 'Çıkış görevi' : item.kind === 'lesson' ? `${kindLabel(item)} · ${item.minutes} dk` : kindLabel(item)}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>

        <footer className="learn-foot">
          <p className="muted small">
            İlerlemen bu tarayıcıda tutulur. Başka bir cihazda devam etmek için dosyaya kaydet, orada yükle.
          </p>
          <div className="btn-row">
            <button type="button" onClick={onSave}>
              💾 İlerlemeyi kaydet
            </button>
            <button type="button" onClick={() => fileRef.current?.click()}>
              📂 İlerlemeyi yükle
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={`${PROGRESS_EXTENSION},.json,application/json`}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) onLoad(f);
            }}
          />
        </footer>
      </div>
    </div>
  );
}
