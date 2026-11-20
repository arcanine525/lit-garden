import { createElement, type ReactNode } from 'react';
import type { RootContent } from 'mdast';
import { parseMarkdown } from '../../../prototypes/editor/src/markdown.js';
import { prepareMarkdown } from '../../shared/editor-markdown';
import { PrivateImage } from './private-image';

function render(node: RootContent, key: number): ReactNode {
  const children = 'children' in node ? node.children.map(render) : undefined;
  switch (node.type) {
    case 'text': return node.value;
    case 'heading': return createElement(`h${Math.min(node.depth + 1,6)}`,{ key },children);
    case 'paragraph': return <p key={key}>{children}</p>;
    case 'strong': return <strong key={key}>{children}</strong>;
    case 'emphasis': return <em key={key}>{children}</em>;
    case 'break': return <br key={key}/>;
    case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
    case 'list': return node.ordered ? <ol key={key} start={node.start ?? 1}>{children}</ol> : <ul key={key}>{children}</ul>;
    case 'listItem': return <li key={key}>{children}</li>;
    case 'link': return <a key={key} href={node.url} title={node.title ?? undefined} rel="noreferrer">{children}</a>;
    case 'image': return <PrivateImage key={key} reference={node.url} alt={node.alt ?? ''}/>;
    case 'table': {
      const [head,...body] = node.children;
      const align = node.align ?? [];
      return <div className="markdown-table" key={key}><table>
        <thead><tr>{head.children.map((cell,index) => <th key={index} scope="col" style={{ textAlign: align[index] ?? undefined }}>{cell.children.map(render)}</th>)}</tr></thead>
        <tbody>{body.map((row,index) => <tr key={index}>{row.children.map((cell,column) =>
          <td key={column} style={{ textAlign: align[column] ?? undefined }}>{cell.children.map(render)}</td>)}</tr>)}</tbody>
      </table></div>;
    }
    default: return null;
  }
}

export function MarkdownDocument({ source }: { source: string }) {
  try {
    const tree = parseMarkdown(prepareMarkdown(source,'teacher'));
    return <div className="markdown-document">{tree.children.map(render)}</div>;
  } catch { return <p className="app-error" role="alert">Không đọc được nội dung Markdown.</p>; }
}
