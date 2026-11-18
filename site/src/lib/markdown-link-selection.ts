import { markdownToMdast, type Position } from 'satteri';
import { decodeHTMLStrict } from 'entities';
import { MARKDOWN_FEATURES } from './markdown-features.js';
import { positionedText, type SourceContainer, type Unit } from './gallery-source.js';

/** A locator that cannot prove a Markdown link's byte ranges.
 * The module deliberately knows nothing about TranslationError or the compiler;
 * the analyzer maps this to `other`, the compiler to translation_unsupported_source. */
export class LinkLocatorError extends Error {
  constructor() { super('Markdown link selection could not be located'); }
}

interface Node {
  type: string;
  position?: Position;
  children?: Node[];
  value?: string;
  url?: string;
  title?: string | null;
  [key: string]: unknown;
}

export type LinkSelectionKind = 'link' | 'image' | 'imageReference' | 'linkReference'
  | 'definition' | 'code' | 'inlineCode' | 'html' | 'text' | 'other';

export interface LinkRanges {
  start: number; end: number;
  labelStart: number; labelEnd: number;
  destinationStart: number; destinationEnd: number;
  url: string;
  removalSafe: boolean;
}

export type LinkSelection =
  | { kind: 'link'; link: LinkRanges }
  | { kind: 'text'; label: string }
  | { kind: Exclude<LinkSelectionKind, 'link' | 'text'> };

const INTEREST: Record<string, true> = {
  link: true, linkReference: true, image: true, imageReference: true,
  definition: true, code: true, inlineCode: true, html: true,
};
const fail = (): never => { throw new LinkLocatorError(); };

function rangeOf(node: Node, source: string): { start: number; end: number } {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < start || end > source.length) return fail();
  return { start, end };
}

/** End index of a balanced `[...]` label (points at the closing `]`). */
export function labelEnd(source: string, from: number, to: number): number {
  if (source[from] !== '[') return fail();
  let depth = 1;
  for (let at = from + 1; at < to; at++) {
    if (source[at] === '\\') { at++; continue; }
    if (source[at] === '`') {
      let end = at + 1;
      while (source[end] === '`') end++;
      const run = source.slice(at, end);
      const closing = source.indexOf(run, end);
      if (closing >= 0 && closing < to) { at = closing + run.length - 1; continue; }
    }
    if (source[at] === '[') depth++;
    if (source[at] === ']' && --depth === 0) return at;
  }
  return fail();
}

/** Content range of a link title at the end of a link node. */
export function markdownTitle(source: string, range: { start: number; end: number }, value: string): { start: number; end: number } {
  let end = range.end - 1;
  if (source[end] !== ')') return fail();
  while (end > range.start && /\s/u.test(source[end - 1]!)) end--;
  const closer = source[--end];
  const opener = closer === ')' ? '(' : closer;
  if (opener !== '(' && opener !== '"' && opener !== "'") return fail();
  for (let at = end - 1; at > range.start; at--) {
    if (source[at] !== opener) continue;
    let slash = at - 1;
    while (source[slash] === '\\') slash--;
    if ((at - slash - 1) % 2) continue;
    const decoded = decodeHTMLStrict(source.slice(at + 1, end).replace(/\\([!-/:-@[-`{-~])/gu, '$1'));
    if (decoded === value) return { start: at + 1, end };
  }
  return fail();
}

/** Byte ranges of a bracket-form inline link, or LinkLocatorError (autolinks have none). */
export function linkRanges(node: Node, source: string): Omit<LinkRanges, 'removalSafe'> {
  if (node.type !== 'link' || typeof node.url !== 'string') return fail();
  const range = rangeOf(node, source);
  if (source[range.start] !== '[') return fail();
  const close = labelEnd(source, range.start, range.end);
  if (source[close + 1] !== '(') return fail();
  let start = close + 2;
  while (source[start] === ' ' || source[start] === '\t') start++;
  const title = node.title ? markdownTitle(source, range, String(node.title)) : null;
  let end = title ? title.start - 1 : range.end - 1;
  while (end > start && (source[end - 1] === ' ' || source[end - 1] === '\t')) end--;
  if (end <= start) return fail();
  let destinationStart = start;
  let destinationEnd = end;
  if (source[start] === '<') {
    if (source[end - 1] !== '>') return fail();
    destinationStart++;
    destinationEnd--;
  }
  if (decodeHTMLStrict(source.slice(destinationStart, destinationEnd).replace(/\\([!-/:-@[-`{-~])/gu, '$1')) !== node.url) return fail();
  return {
    start: range.start, end: range.end,
    labelStart: range.start + 1, labelEnd: close,
    destinationStart, destinationEnd, url: node.url,
  };
}

/** Inner byte range of a `[id]: destination` definition, or LinkLocatorError. */
export function definitionRanges(node: Node, source: string): { destinationStart: number; destinationEnd: number; url: string } {
  if (node.type !== 'definition' || typeof node.url !== 'string') return fail();
  const range = rangeOf(node, source);
  if (source[range.start] !== '[') return fail();
  const close = labelEnd(source, range.start, range.end);
  if (source[close + 1] !== ':') return fail();
  let at = close + 2;
  while (source[at] === ' ' || source[at] === '\t') at++;
  if (source[at] === '\r') at++;
  if (source[at] === '\n') at++;
  while (source[at] === ' ' || source[at] === '\t') at++;
  let start = at;
  let end = at;
  if (source[at] === '<') {
    const closing = source.indexOf('>', at + 1);
    if (closing < 0 || closing >= range.end) return fail();
    start = at + 1;
    end = closing;
  } else {
    while (end < range.end && !/\s/u.test(source[end]!)) end++;
  }
  if (end <= start) return fail();
  if (decodeHTMLStrict(source.slice(start, end).replace(/\\([!-/:-@[-`{-~])/gu, '$1')) !== node.url) return fail();
  return { destinationStart: start, destinationEnd: end, url: node.url };
}

function linksIn(node: Node, source: string, found: string[] = []): string[] {
  if (node.type === 'link' && typeof node.url === 'string') found.push(node.url);
  for (const child of node.children ?? []) linksIn(child, source, found);
  return found;
}

/** Removing a link is safe only when it cannot turn surrounding literal text into a new link. */
export function removalSafe(node: Node, body: string, ranges: Omit<LinkRanges, 'removalSafe'>): boolean {
  try {
    const before = linksIn(markdownToMdast(body, { features: MARKDOWN_FEATURES }) as Node, body).sort();
    const removed = body.slice(0, ranges.start) + body.slice(ranges.labelStart, ranges.labelEnd) + body.slice(ranges.end);
    const after = linksIn(markdownToMdast(removed, { features: MARKDOWN_FEATURES }) as Node, removed).sort();
    const expected = [...before];
    const index = expected.indexOf(ranges.url);
    if (index < 0) return false;
    expected.splice(index, 1);
    return JSON.stringify(expected) === JSON.stringify(after);
  } catch {
    return false;
  }
}

function containing(tree: Node): { node: Node; parents: Node[]; depth: number }[] {
  const rows: { node: Node; parents: Node[]; depth: number }[] = [];
  const walk = (node: Node, parents: Node[], depth: number) => {
    rows.push({ node, parents, depth });
    for (const child of node.children ?? []) walk(child, [...parents, node], depth + 1);
  };
  walk(tree, [], 0);
  return rows;
}

function textOf(node: Node): string {
  return (node.value ?? '') + (node.children ?? []).map(textOf).join('');
}

const LABEL_PUNCTUATION = /[!-/:-@[-`{-~]|^\s+|\s+$/gu;
function escapeLabelText(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').replace(LABEL_PUNCTUATION, (part) =>
    Array.from(part, (char) => `&#${char.codePointAt(0)};`).join(''));
}

function containersFor(parents: Node[]): SourceContainer[] {
  const containers: SourceContainer[] = [];
  for (const parent of parents) {
    if (parent.type === 'blockquote') containers.push({ kind: 'quote' });
    if (parent.type === 'listItem' && parent.position) {
      const first = parent.children?.find((child) => child.position)?.position;
      containers.push({ kind: 'list', indent: Math.max(0, first ? first.start.column - parent.position.start.column : 0) });
    }
  }
  return containers;
}

/** Map a selection to a safe label, or LinkLocatorError.
 * Units must tile [from,to) with no overhang: a boundary inside an escape/entity,
 * a container prefix gap or a CR/LF boundary refuses. */
export function selectedLabel(node: Node, body: string, from: number, to: number, parents: Node[]): string {
  const range = rangeOf(node, body);
  if (from < range.start || to > range.end || from >= to) return fail();
  const value = (node.value ?? '').replace(/\r\n?/gu, '\n');
  const units = positionedText(value, body, range.start, range.end, containersFor(parents));
  const intersected = units.filter((unit: Unit) => unit.end > from && unit.start < to);
  if (!intersected.length) return fail();
  for (const unit of intersected) {
    if (unit.start < from || unit.end > to) return fail();
  }
  for (let i = 1; i < intersected.length; i++) {
    if (intersected[i - 1]!.end !== intersected[i]!.start) return fail();
  }
  if (intersected[0]!.start !== from || intersected[intersected.length - 1]!.end !== to) return fail();
  const text = intersected.map((unit) => unit.value).join('').replace(/[\r\n]+/gu, ' ');
  if (!text.trim()) return fail();
  const label = escapeLabelText(text);
  const parsed = markdownToMdast(`[${label}](https://h.invalid/)`, { features: MARKDOWN_FEATURES }) as Node;
  const links: Node[] = [];
  const collect = (item: Node) => { if (item.type === 'link') links.push(item); for (const child of item.children ?? []) collect(child); };
  collect(parsed);
  if (links.length !== 1 || textOf(links[0]!) !== text) return fail();
  return label;
}

export function analyzeLinkSelection(body: string, from: number, to: number): LinkSelection {
  try {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > body.length) return { kind: 'other' };
    const tree = markdownToMdast(body, { features: MARKDOWN_FEATURES }) as Node;
    const rows = containing(tree)
      .filter(({ node }) => node.position?.start.offset !== undefined && node.position?.end.offset !== undefined
        && node.position.start.offset <= from && to <= node.position.end.offset);
    if (!rows.length) return { kind: 'other' };
    const deepest = rows.reduce((best, row) => (row.depth > best.depth ? row : best));
    const target = deepest.node;

    if (target.type === 'text') {
      const ancestor = [...deepest.parents].reverse().find((node) => INTEREST[node.type]);
      if (!ancestor) {
        const label = selectedLabel(target, body, from, to, deepest.parents);
        return { kind: 'text', label };
      }
      return selectionFor(ancestor, body);
    }
    if (INTEREST[target.type]) return selectionFor(target, body);
    return { kind: 'other' };
  } catch {
    return { kind: 'other' };
  }
}

function selectionFor(node: Node, body: string): LinkSelection {
  if (node.type === 'link') {
    const ranges = linkRanges(node, body);
    return { kind: 'link', link: { ...ranges, removalSafe: removalSafe(node, body, ranges) } };
  }
  return { kind: node.type as LinkSelectionKind } as LinkSelection;
}
