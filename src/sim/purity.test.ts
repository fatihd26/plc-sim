import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Çekirdek UI'dan bağımsız ve deterministik kalmalı (modules/ dahil).
const FORBIDDEN: [RegExp, string][] = [
  [/from ['"]react/, 'React bağımlılığı'],
  [/\b(window|document|requestAnimationFrame)\b/, 'DOM erişimi'],
  [/Math\.random|Date\.now|performance\.now/, 'deterministik olmayan kaynak'],
  [/Math\.(exp|pow|sin|cos|tan|atan2?|acos|asin|log|hypot|cbrt)\b/, 'motorlar arası farklı sonuç verebilen Math fonksiyonu'],
];

const dir = import.meta.dirname;
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const sources = walk(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => relative(dir, f));

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
