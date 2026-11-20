import type { HeadingTagType } from '@lexical/rich-text';
import type { ReactNode, RefObject } from 'react';
import type { WorksheetActions, WorksheetFormat } from './editor-plugins';

export function WorksheetToolbar({ actions, format, source, disabled, image, toggle, menu }: {
  actions: RefObject<WorksheetActions | null>; format: WorksheetFormat; source: boolean; disabled: boolean;
  image?: () => void; toggle: () => void; menu: ReactNode;
}) {
  const formattingDisabled = disabled || source;
  const blockDisabled = formattingDisabled || format.inTable;

  return <>
    <details className="worksheet-overflow">
      <summary className="app-button" aria-label="Thao tác Markdown">⋯</summary>
      <div className="app-actions">
        <button type="button" disabled={formattingDisabled} onClick={() => actions.current?.undo()}>Hoàn tác</button>
        <button type="button" disabled={formattingDisabled} onClick={() => actions.current?.redo()}>Làm lại</button>
        {menu}
      </div>
    </details>
    <div className="worksheet-toolbar" role="group" aria-label="Định dạng Markdown"
      onPointerDown={event => { if (event.target instanceof HTMLElement && event.target.closest('button')) event.preventDefault(); }}>
      <button type="button" disabled={formattingDisabled} aria-pressed={format.bold && !source}
        onClick={() => actions.current?.format('bold')}>Đậm</button>
      <button type="button" disabled={formattingDisabled} aria-pressed={format.italic && !source}
        onClick={() => actions.current?.format('italic')}>Nghiêng</button>
      <select aria-label="Tiêu đề" value="" disabled={blockDisabled} onChange={event => {
        const heading = event.target.value;
        if (heading) actions.current?.block(heading as HeadingTagType | 'paragraph');
      }}>
        <option value="">Tiêu đề</option>
        <option value="paragraph">Đoạn văn</option>
        {[1,2,3,4,5,6].map(level => <option value={`h${level}`} key={level}>Tiêu đề cấp {level}</option>)}
      </select>
      <select aria-label="Danh sách" value="" disabled={blockDisabled} onChange={event => {
        const kind = event.target.value;
        if (kind) actions.current?.list(kind === 'none' ? '' : kind as 'bullet' | 'number');
      }}>
        <option value="">Danh sách</option>
        <option value="bullet">Danh sách dấu đầu dòng</option>
        <option value="number">Danh sách đánh số</option>
        <option value="none">Bỏ danh sách</option>
      </select>
      <button type="button" disabled={blockDisabled} onClick={() => actions.current?.block('quote')}>Trích dẫn</button>
      <button type="button" disabled={blockDisabled} onClick={() => actions.current?.table()}>Bảng</button>
      <button type="button" disabled={formattingDisabled} onClick={() => actions.current?.link()}>Liên kết</button>
      {image && <button type="button" disabled={formattingDisabled} aria-label="Ảnh · Chèn ảnh" onClick={image}>Ảnh</button>}
      <button type="button" className="worksheet-mode" aria-pressed={source} onClick={toggle}>
        {source ? 'Trực quan' : 'Mã Markdown'}
      </button>
    </div>
  </>;
}
