'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { LibraryFields, LibraryFormat } from '../../../../server/library/format';
import { EditorWorkbench } from '../../../editor/editor-workbench';
import type { EditorHandle } from '../../../editor/markdown-editor';

const errors: Record<string,string> = {
  UNSUPPORTED_LIBRARY_FILE:'Chọn một tệp PDF hợp lệ hoặc TXT mã hóa UTF-8.',
  LIBRARY_SIZE:'Tệp vượt quá 8 MB.',
  INVALID_LIBRARY:'Điền tên và nội dung tài liệu hoặc chọn tệp hợp lệ.',
  ASSET_SCOPE:'Ảnh cần thuộc chính tài liệu đang lưu.',
  LIBRARY_CHANGED:'Tài liệu đã được thay đổi. Mở lại trang để tải bản mới nhất.',
  DRIVE_SETUP_REQUIRED:'Kết nối Drive trước khi lưu tài liệu.'
};

export function LibraryEditor({ id, version, initial }: { id: string; version: string; initial?: LibraryFields & { markdown: string } }) {
  const router = useRouter();
  const editor = useRef<EditorHandle>(null);
  const markdown = useRef(initial?.markdown ?? '');
  const attempt = useRef<FormData | null>(null);
  const active = useRef(false);
  const [format,setFormat] = useState<LibraryFormat>(initial?.format ?? 'markdown');
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState(false);
  const [status,setStatus] = useState('');

  async function write(data: FormData) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setStatus('Đang lưu tài liệu…');
    try {
      const response = await fetch(`/api/library/${id}`,{ method:'PUT',body:data });
      const result = await response.json();
      if (response.status === 202) { setPending(true); setStatus('Chưa xác nhận tài liệu đã lưu.'); return; }
      if (!response.ok) {
        if (response.status < 500) {
          attempt.current = null;
          setPending(false);
          setStatus(errors[result.error] ?? 'Chưa lưu được tài liệu. Kiểm tra nội dung và thử lại.');
          return;
        }
        throw Error(result.error);
      }
      router.push(`/library/${id}`);
    } catch { setPending(true); setStatus('Chưa xác nhận tài liệu đã lưu.'); }
    finally { active.current = false; setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (attempt.current) { void write(attempt.current); return; }
    const data = new FormData(event.currentTarget);
    data.set('version',version);
    data.set('key',crypto.randomUUID());
    if (format === 'markdown') data.set('markdown',editor.current?.getMarkdown() ?? markdown.current);
    attempt.current = data;
    void write(data);
  }

  return <form className="app-panel library-editor" onSubmit={submit}>
    <fieldset disabled={busy || pending}>
      <legend>Thông tin tài liệu</legend>
      <label>Tên tài liệu<input name="title" maxLength={160} defaultValue={initial?.title} required/></label>
      <label>Chuyên mục<input name="category" maxLength={100} defaultValue={initial?.category}/></label>
      <label>Tác giả<input name="author" maxLength={160} defaultValue={initial?.author}/></label>
      <label>Nguồn<input name="sourceLabel" maxLength={300} defaultValue={initial?.sourceLabel}/></label>
      <label>Giới thiệu<textarea name="excerpt" maxLength={2000} defaultValue={initial?.excerpt}/></label>
      <label>Loại tài liệu<select name="format" value={format} onChange={event => setFormat(event.target.value as LibraryFormat)}>
        <option value="markdown">Soạn Markdown</option><option value="pdf">Tệp PDF</option><option value="text">Tệp TXT</option>
      </select></label>
      {format !== 'markdown' && <label>{initial?.format === format ? 'Chọn tệp thay thế' : 'Chọn tệp'}<input key={format} type="file" name="file"
        required={initial?.format !== format}
        accept={format === 'pdf' ? 'application/pdf,.pdf' : 'text/plain,.txt'}/></label>}
    </fieldset>
    {format === 'markdown' && <EditorWorkbench role="teacher" libraryId={id} editorRef={editor} initialMarkdown={markdown.current}
      readOnly={busy || pending} onMarkdownChange={source => { markdown.current = source; }}/>}
    <p role="status">{status}</p>
    <button type="submit" className="app-primary" disabled={busy}>{pending ? 'Thử lưu lại' : initial ? 'Lưu thay đổi' : 'Lưu tài liệu'}</button>
  </form>;
}
