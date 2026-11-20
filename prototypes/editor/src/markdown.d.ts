import type { Root } from 'mdast';

export type MarkdownNode = { type: string; url?: string; identifier?: string; children?: MarkdownNode[] };
export type ProjectionRun = { value: string; start: number; end: number };
export type ProjectedNode = Omit<MarkdownNode,'children'> & { children?: ProjectedNode[]; run?: ProjectionRun; suffix?: ProjectionRun;
  title?: string | null; alt?: string | null; depth?: number; ordered?: boolean; start?: number; align?: ('left' | 'center' | 'right' | null)[] };
export function parseMarkdown(source: string): Root;
export function validateMarkdown(source: string, role?: 'teacher' | 'student', maxLength?: number): Root;
export function prepareEditorMarkdown(source: string, role: 'teacher' | 'student', maxLength?: number): string;
export function referenceDefinitions(tree: Root): Map<string, { url: string; title?: string | null }>;
export function walk(node: MarkdownNode, visit: (node: MarkdownNode) => void): void;
export function semantic(source: string): unknown;
export function projectMarkdown(source: string): { tree: ProjectedNode; text: string; projection: 'vv-render-text-v1' };
