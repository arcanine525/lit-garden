import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

const parser = unified().use(remarkParse).use(remarkGfm);
export const parseMarkdown = (source) => parser.parse(source);
export const assetPattern = /^\/api\/assets\/[a-zA-Z0-9_-]+$/;
const allowed = new Set(['root', 'paragraph', 'text', 'heading', 'strong', 'emphasis', 'list', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell', 'link', 'linkReference', 'definition', 'image', 'imageReference', 'break']);
const safeLink = (url) => {
  try { const u = new URL(url); return ['https:', 'http:', 'mailto:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};
export function validateMarkdown(source, role = 'student') {
  if (typeof source !== 'string' || source.length > 100000) throw Error('MARKDOWN_SIZE');
  const tree = parseMarkdown(source);
  const definitions = new Map();
  walk(tree, (n) => { if (n.type === 'definition') definitions.set(n.identifier, n); });
  walk(tree, (n) => {
    if (!allowed.has(n.type)) throw Error(`UNSUPPORTED_${n.type}`);
    // CommonMark treats unknown MDX expressions/JSX as text: explicitly refuse source syntax too.
    if (n.type === 'text' && /<\/?[A-Za-z][^>]*>|\{[^}]*\}|^(import|export)\s/m.test(n.value)) throw Error('UNSUPPORTED_MDX');
    if (n.type === 'listItem' && n.checked != null) throw Error('UNSUPPORTED_TASK_LIST');
    if (n.type === 'image' || n.type === 'imageReference') {
      if (role !== 'teacher') throw Error('STUDENT_IMAGE_FORBIDDEN');
      const url = n.url ?? definitions.get(n.identifier)?.url;
      if (!assetPattern.test(url ?? '')) throw Error('PRIVATE_ASSET_REQUIRED');
    }
    if (n.type === 'link' || n.type === 'linkReference') {
      if (!safeLink(n.url ?? definitions.get(n.identifier)?.url)) throw Error('UNSAFE_LINK');
    }
  });
  return tree;
}
export function walk(node, visit) { visit(node); node.children?.forEach((n) => walk(n, visit)); }

// vv-render-text-v1: UTF-16 offsets, exact Unicode (no NFC folding).
// Leaves are text; hard breaks are LF; block endings are LF; table cells TAB.
// Link destinations and image alt/src are excluded from annotatable text.
export function projectMarkdown(source) {
  const tree = parseMarkdown(source);
  let text = '';
  function add(value) { const start = text.length; text += value; return { value, start, end: text.length }; }
  function visit(n) {
    const out = { ...n }; delete out.position;
    if (n.type === 'text') out.run = add(n.value.replace(/\r\n?/g, '\n'));
    if (n.type === 'break') out.run = add('\n');
    out.children = n.children?.map(visit);
    if (['paragraph', 'heading', 'tableRow'].includes(n.type)) out.suffix = add('\n');
    if (n.type === 'tableCell') out.suffix = add('\t');
    return out;
  }
  return { tree: visit(tree), get text() { return text; }, projection: 'vv-render-text-v1' };
}
// Semantic comparison permits marker changes, whitespace around blocks, and
// serializer changes to hard-break spelling; preserves AST content/structure.
export function semantic(source) {
  const tree = parseMarkdown(source);
  const definitions = new Map();
  walk(tree, (n) => { if (n.type === 'definition') definitions.set(n.identifier, n); });
  function clean(n) {
    if (n.type === 'definition') return null;
    const type = n.type === 'linkReference' ? 'link' : n.type === 'imageReference' ? 'image' : n.type;
    const def = definitions.get(n.identifier);
    const result = { type };
    for (const key of ['value', 'depth', 'ordered', 'start', 'align', 'url', 'title', 'alt']) {
      let value = n[key] ?? def?.[key];
      if (key === 'title' && value === '') value = null;
      if (value != null) result[key] = value;
    }
    if (n.children) result.children = n.children.map(clean).filter(Boolean);
    return result;
  }
  return clean(tree);
}
export async function sha256(value) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
