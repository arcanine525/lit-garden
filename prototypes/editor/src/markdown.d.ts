import type { Root } from 'mdast';

export type MarkdownNode = { type: string; url?: string; identifier?: string; children?: MarkdownNode[] };
export function parseMarkdown(source: string): Root;
export function validateMarkdown(source: string, role?: 'teacher' | 'student', maxLength?: number): Root;
export function prepareEditorMarkdown(source: string, role: 'teacher' | 'student', maxLength?: number): string;
export function referenceDefinitions(tree: Root): Map<string, { url: string; title?: string | null }>;
export function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void;
export function semantic(source: string): unknown;
