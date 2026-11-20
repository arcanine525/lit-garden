'use client';

import { createElement, Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, projectMarkdown, referenceDefinitions, type ProjectedNode, type ProjectionRun } from '../../../prototypes/editor/src/markdown.js';
import type { RangeComment } from '../../shared/review';

export function ReviewDocument({ source, marks }: { source: string; marks: RangeComment[] }) {
  const { tree,definitions } = useMemo(() => ({ tree:projectMarkdown(source).tree,
    definitions:referenceDefinitions(parseMarkdown(source)) }),[source]);
  const ordered = [...marks].sort((a,b) => a.id.localeCompare(b.id));

  function renderRun(run: ProjectionRun) {
    const covered = ordered.filter(mark => mark.anchor.start < run.end && mark.anchor.end > run.start);
    const cuts = [...new Set([run.start,run.end,...covered.flatMap(mark => [mark.anchor.start,mark.anchor.end])])]
      .filter(point => point >= run.start && point <= run.end).sort((a,b) => a-b);
    return <span data-review-start={run.start} data-review-end={run.end}>{cuts.slice(0,-1).map((start,index) => {
      const end = cuts[index+1];
      const active = covered.filter(mark => mark.anchor.start <= start && mark.anchor.end >= end);
      const value = run.value.slice(start-run.start,end-run.start);
      return active.length ? <mark key={start} className={`review-mark-${active[0].color}`} data-comments={active.map(mark => mark.id).join(' ')}>{value}</mark> :
        <Fragment key={start}>{value}</Fragment>;
    })}</span>;
  }

  function render(node: ProjectedNode, key: number): ReactNode {
    if (node.type === 'break') return <br key={key}/>;
    if (node.run) return <Fragment key={key}>{renderRun(node.run)}</Fragment>;
    const children = node.children?.map(render);
    switch (node.type) {
      case 'root': return children;
      case 'paragraph': return <p key={key}>{children}</p>;
      case 'heading': return createElement(`h${Math.min((node.depth ?? 1)+1,6)}`,{ key },children);
      case 'strong': return <strong key={key}>{children}</strong>;
      case 'emphasis': return <em key={key}>{children}</em>;
      case 'blockquote': return <blockquote key={key}>{children}</blockquote>;
      case 'list': return node.ordered ? <ol key={key} start={node.start ?? 1}>{children}</ol> : <ul key={key}>{children}</ul>;
      case 'listItem': return <li key={key}>{children}</li>;
      case 'link': case 'linkReference': {
        const href = node.url ?? definitions.get(node.identifier ?? '')?.url;
        return <a key={key} href={href} rel="noreferrer">{children}</a>;
      }
      case 'table': {
        const [head,...body] = node.children ?? [];
        const alignment = node.align ?? [];
        return <div className="markdown-table" key={key}><table>
          <thead><tr>{head?.children?.map((cell,index) => <th key={index} scope="col" style={{ textAlign:alignment[index] ?? undefined }}>
            {cell.children?.map(render)}</th>)}</tr></thead>
          <tbody>{body.map((row,index) => <tr key={index}>{row.children?.map((cell,column) =>
            <td key={column} style={{ textAlign:alignment[column] ?? undefined }}>{cell.children?.map(render)}</td>)}</tr>)}</tbody>
        </table></div>;
      }
      default: return null;
    }
  }
  return <div className="markdown-document">{render(tree,0)}</div>;
}

export function selectedReviewRange(article: HTMLElement | null) {
  const selection = window.getSelection();
  if (!article || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  function offset(container: Node, position: number) {
    const element = container instanceof Element ? container : container.parentElement;
    const run = element?.closest<HTMLElement>('[data-review-start]');
    if (!run || !article?.contains(run)) return null;
    const before = document.createRange();
    before.selectNodeContents(run);
    before.setEnd(container,position);
    return Number(run.dataset.reviewStart)+before.toString().length;
  }
  const start = offset(range.startContainer,range.startOffset), end = offset(range.endContainer,range.endOffset);
  return start !== null && end !== null && end > start ? { start,end } : null;
}
