import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Çekirdek UI'dan bağımsız ve deterministik kalmalı.
const FORBIDDEN: [RegExp, string][] = [
  [/from ['"]react/, 'React bağımlılığı'],
  [/\b(window|document|requestAnimationFrame)\b/, 'DOM erişimi'],
  [/Math\.random|Date\.now|performance\.now/, 'deterministik olmayan kaynak'],
  [/Math\.(exp|pow|sin|cos|tan|log)\b/, 'motorlar arası farklı sonuç verebilen Math fonksiyonu'],
];

const dir = import.meta.dirname;
const sources = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

describe('çekirdek saflığı', () => {
  it.each(sources)('%s yasak API kullanmaz', (file) => {
    const code = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const [re, why] of FORBIDDEN) {
      expect(re.test(code), `${file}: ${why}`).toBe(false);
    }
  });
});
