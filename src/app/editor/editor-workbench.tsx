'use client';

import dynamic from 'next/dynamic';
import type { EditorProps } from './markdown-editor';

const Editor = dynamic(() => import('./markdown-editor').then(module => module.MarkdownEditor), {
  ssr: false, loading: () => <p role="status">Đang tải trình soạn thảo…</p>
});

export function EditorWorkbench(props: EditorProps) {
  return <Editor {...props}/>;
}
