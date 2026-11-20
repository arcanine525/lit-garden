import { prepareEditorMarkdown, referenceDefinitions, validateMarkdown, walk } from '../../prototypes/editor/src/markdown.js';

export type EditorRole = 'teacher' | 'student';
export const maxMarkdownBytes = 1024 * 1024;
export const assetReference = /^\/api\/assets\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;

export function inspectMarkdown(input: unknown, role: EditorRole) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > maxMarkdownBytes) throw Error('MARKDOWN_SIZE');
  const tree = validateMarkdown(input,role,maxMarkdownBytes);
  const definitions = referenceDefinitions(tree);
  const assets = new Set<string>();
  walk(tree, node => {
    if (node.type !== 'image' && node.type !== 'imageReference') return;
    const url = node.url ?? (node.identifier ? definitions.get(node.identifier)?.url : undefined);
    const id = assetReference.exec(url ?? '')?.[1];
    if (!id) throw Error('PRIVATE_ASSET_REQUIRED');
    assets.add(id);
  });
  return { tree, assets: [...assets], markdown: input };
}

export function prepareMarkdown(input: string, role: EditorRole) {
  inspectMarkdown(input,role);
  return prepareEditorMarkdown(input,role,maxMarkdownBytes);
}
