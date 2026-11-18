import { describe, expect, it } from 'vitest';
import { markdownToMdast } from 'satteri';
import { analyzeLinkSelection } from './markdown-link-selection.js';
import { MARKDOWN_FEATURES } from './markdown-features.js';

interface MdNode { type: string; value?: string; children?: MdNode[]; url?: string }

function indexOf(body: string, marker: string): number {
  const index = body.indexOf(marker);
  if (index < 0) throw new Error(`missing marker ${marker}`);
  return index;
}
function analyzeAt(body: string, marker: string, offset = 0) {
  const start = indexOf(body, marker) + offset;
  return analyzeLinkSelection(body, start, start + marker.length - offset);
}
function labelText(label: string): string {
  const tree = markdownToMdast(`[${label}](https://h.invalid/)`, { features: MARKDOWN_FEATURES }) as MdNode;
  const links: MdNode[] = [];
  const walk = (node: MdNode) => {
    if (node.type === 'link') links.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  if (links.length !== 1) return '';
  const text = (node: MdNode): string => (node.value ?? '') + (node.children ?? []).map(text).join('');
  return text(links[0]!);
}

describe('Markdown link selection analysis', () => {
  it('resolves a bracket link, its ranges and a safe removal', () => {
    const body = 'Vor [Karte](/karte/ "Titel") nach.';
    const result = analyzeAt(body, 'Karte');
    expect(result.kind).toBe('link');
    if (result.kind !== 'link') return;
    expect(result.link.url).toBe('/karte/');
    expect(body.slice(result.link.destinationStart, result.link.destinationEnd)).toBe('/karte/');
    expect(body.slice(result.link.labelStart, result.link.labelEnd)).toBe('Karte');
    expect(result.link.removalSafe).toBe(true);
  });

  it('handles angle destinations, leading spaces and paren titles', () => {
    for (const [body, url, destination] of [
      ['[x](</a b> "T")', '/a b', '/a b'],
      ['[x]( /a)', '/a', '/a'],
      ['[x](/a(b) "T")', '/a(b)', '/a(b)'],
      ['[x](/a (b))', '/a', '/a'],
    ] as const) {
      const result = analyzeLinkSelection(body, 1, 2);
      expect(result.kind).toBe('link');
      if (result.kind !== 'link') continue;
      expect(result.link.url).toBe(url);
      expect(body.slice(result.link.destinationStart, result.link.destinationEnd)).toBe(destination);
    }
  });

  it('resolves nested links to the inner link or plain text, and blocks an unsafe outer removal', () => {
    const nested = '[a [b](/c) d](/e)';
    const inner = analyzeAt(nested, 'b');
    expect(inner.kind).toBe('link');
    if (inner.kind === 'link') expect(inner.link.url).toBe('/c');
    const outerText = analyzeAt(nested, 'd');
    expect(outerText.kind).toBe('text');
    if (outerText.kind === 'text') expect(outerText.label).toBe('d');
    const removal = analyzeLinkSelection(nested, indexOf(nested, 'b') - 1, indexOf(nested, 'b') + 1);
    expect(removal.kind).toBe('link');
    if (removal.kind === 'link') expect(removal.link.removalSafe).toBe(false);
  });

  it('classifies references, definitions, images, code and HTML as refusals', () => {
    const cases: [string, string, string][] = [
      ['[alpha beta][ref]\n\n[ref]: /u', 'alpha', 'linkReference'],
      ['![alt](/img)', 'alt', 'image'],
      ['![alt][ref]\n\n[ref]: /img', 'alt', 'imageReference'],
      ['[ref]: /x', 'ref', 'definition'],
      ['`code`', 'code', 'inlineCode'],
      ['```\n[x](/a)\n```', '[x]', 'code'],
      ['<div>\n[x](/a)\n</div>', '[x]', 'html'],
      ['<https://e.test/>', 'https', 'other'],
    ];
    for (const [body, marker, kind] of cases) {
      expect(analyzeAt(body, marker).kind, body).toBe(kind);
    }
  });

  it('returns text only for a single plain-text run and a safe label', () => {
    expect(analyzeAt('**bold**', 'bold')).toMatchObject({ kind: 'text' });
    expect(analyzeAt('**bold**', '**').kind).toBe('other');
    expect(analyzeAt('# heading', '#').kind).toBe('other');
    expect(analyzeAt('| A |\n| --- |\n| x |', '---').kind).toBe('other');
    expect(analyzeAt('- [ ] task', '[ ]').kind).toBe('other');
    expect(analyzeLinkSelection('a\n\nb', 0, 4).kind).toBe('other');
    const quote = '> one\n> two';
    expect(analyzeLinkSelection(quote, quote.indexOf('one'), quote.indexOf('two') + 3)).toEqual({ kind: 'other' });
    const table = '| A |\n| --- |\n| a\\*b |';
    const label = analyzeAt(table, 'a\\*b');
    expect(label.kind).toBe('text');
    if (label.kind === 'text') {
      expect(labelText(label.label)).toBe('a*b');
      expect(label.label).not.toMatch(/[*]/);
    }
    expect(analyzeAt('a|b', 'a|b')).toMatchObject({ kind: 'text' });
  });

  it('refuses an escape/entity boundary, an empty selection and container gaps', () => {
    const entity = 'Tom &amp; Jerry';
    expect(analyzeLinkSelection(entity, 0, 9)).toMatchObject({ kind: 'text' });
    expect(analyzeLinkSelection(entity, 0, 5)).toEqual({ kind: 'other' });
    expect(analyzeLinkSelection(entity, 0, 0)).toEqual({ kind: 'other' });
    expect(analyzeAt('   ', '   ')).toEqual({ kind: 'other' });
    const line = analyzeAt('> one', 'one');
    expect(line.kind).toBe('text');
    const crlf = 'Tom &amp; Jerry\r\nnext';
    expect(analyzeLinkSelection(crlf, 0, 9)).toMatchObject({ kind: 'text' });
  });

  it('labels punctuation safely (emphasis, brackets, pipes)', () => {
    for (const [source, rendered] of [
      ['a\\*b\\*c', 'a*b*c'], ['\\_x\\_', '_x_'], ['a|b', 'a|b'], ['a[b]c', 'a[b]c'],
    ] as const) {
      const body = `pre ${source} post`;
      const start = body.indexOf(source);
      const result = analyzeLinkSelection(body, start, start + source.length);
      expect(result.kind, source).toBe('text');
      if (result.kind !== 'text') continue;
      expect(labelText(result.label)).toBe(rendered);
    }
  });

  it('rejects invalid offsets', () => {
    expect(analyzeLinkSelection('abc', -1, 2)).toEqual({ kind: 'other' });
    expect(analyzeLinkSelection('abc', 1, 1)).toEqual({ kind: 'other' });
    expect(analyzeLinkSelection('abc', 0, 4)).toEqual({ kind: 'other' });
  });
});
