'use client';

import {
  MDXEditor, headingsPlugin, listsPlugin, quotePlugin, tablePlugin, linkPlugin, linkDialogPlugin, imagePlugin,
  toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, InsertTable, CreateLink,
  type MDXEditorMethods
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type DragEvent, type Ref } from 'react';
import { prepareMarkdown, inspectMarkdown, type EditorRole } from '../../shared/editor-markdown';
import { editorPlugins, type WorksheetActions, type WorksheetFormat } from './editor-plugins';
import { assetBlob } from './asset-client';
import { WorksheetToolbar } from './worksheet-toolbar';

export type EditorHandle = { getMarkdown(): string; setMarkdown(markdown: string): boolean };
export type EditorProps = { initialMarkdown?: string; role: EditorRole; assignmentId?: string; libraryId?: string;
  onMarkdownChange?: (source: string) => void; editorRef?: Ref<EditorHandle>; validate?: boolean; readOnly?: boolean;
  worksheet?: boolean };

const errors: Record<string,string> = {
  PRIVATE_ASSET_REQUIRED: 'Chỉ dùng ảnh đã tải vào bài này.',
  ASSET_SCOPE: 'Ảnh không thuộc bài này.',
  STUDENT_IMAGE_FORBIDDEN: 'Học sinh chỉ có thể soạn nội dung chữ.',
  UNSAFE_LINK: 'Đường dẫn không hợp lệ.',
  MARKDOWN_SIZE: 'Markdown vượt quá dung lượng 1 MB.',
  UNSUPPORTED_UNDERLINE: 'Markdown của Vườn Văn không hỗ trợ gạch chân.',
  UNSUPPORTED_IMAGE: 'Chọn ảnh PNG, JPEG hoặc WebP hợp lệ.',
  IMAGE_LIMIT: 'Ảnh vượt quá 5 MB.',
  DRIVE_SETUP_REQUIRED: 'Hãy kết nối Drive trước khi tải ảnh.',
  DRIVE_RECONNECT: 'Mất quyền Drive. Hãy kết nối lại rồi thử lại ảnh.',
  DRIVE_MISSING: 'Không tìm thấy ảnh trên Drive.',
  DRIVE_FORBIDDEN: 'Drive từ chối quyền truy cập ảnh.',
  DRIVE_QUOTA: 'Drive đang giới hạn truy cập. Hãy thử lại sau.',
  NOT_FOUND: 'Không còn quyền xem ảnh hoặc ảnh đã bị gỡ.',
  DRIVE_UNAVAILABLE: 'Chưa đọc hoặc lưu được ảnh trên Drive. Hãy thử lại.'
};

export function MarkdownEditor({ initialMarkdown = '', role, assignmentId, libraryId, onMarkdownChange, editorRef, validate, readOnly,
  worksheet }: EditorProps) {
  const [initial] = useState(() => {
    try { return { source: prepareMarkdown(initialMarkdown,role), invalid: false }; }
    catch { return { source: initialMarkdown, invalid: true }; }
  });
  const [source, setSource] = useState(initial.source);
  const [mode, setMode] = useState<'rich' | 'source'>(initial.invalid ? 'source' : 'rich');
  const [epoch, setEpoch] = useState(0);
  const [message,setMessage] = useState(initial.invalid ? 'Sửa Markdown trước khi mở trực quan.' : '');
  const [checking,setChecking] = useState(false);
  const [uploading,setUploading] = useState(false);
  const [retryFile,setRetryFile] = useState<File | null>(null);
  const editor = useRef<MDXEditorMethods>(null);
  const tableSnapshot = useRef<() => string | undefined>(() => undefined);
  const worksheetActions = useRef<WorksheetActions>(null);
  const [format,setFormat] = useState<WorksheetFormat>({ bold:false,italic:false,inTable:false });
  const attach = useRef<(reference: string) => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  const initialText = useRef(initial.invalid ? '' : initial.source);
  const rejected = useRef(initial.invalid);
  const lastImport = useRef(initial.source);
  const previewUrls = useRef(new Set<string>());
  const previews = useRef(new Map<string, Promise<string>>());
  const live = useRef(false);
  const uploads = useRef(new WeakMap<File,string>());
  const canInsertImages = role === 'teacher' && !!(assignmentId || libraryId) && !readOnly;

  useEffect(() => {
    const urls = previewUrls.current;
    live.current = true;
    return () => { live.current = false; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);

  const notify = useCallback((error: unknown) => {
    const code = (error as Error).message;
    setMessage(errors[code] ?? 'Định dạng chưa được hỗ trợ. Kiểm tra mã Markdown rồi thử lại.');
  }, []);

  function current() {
    if (mode === 'source' || rejected.current) return source;
    return tableSnapshot.current() ?? editor.current?.getMarkdown() ?? source;
  }

  function apply(input: string) {
    try {
      const normalized = prepareMarkdown(input,role);
      lastImport.current = input;
      if (rejected.current) {
        rejected.current = false;
        initialText.current = normalized;
        setEpoch(value => value + 1);
      } else {
        editor.current?.setMarkdown(normalized);
        if (rejected.current) return false;
      }
      setSource(normalized);
      setMode('rich');
      onMarkdownChange?.(normalized);
      setMessage('');
      return true;
    } catch (error) {
      setSource(input);
      setMode('source');
      notify(error);
      return false;
    }
  }
  useImperativeHandle(editorRef,() => ({ getMarkdown: current, setMarkdown: apply }));

  const preview = useCallback((reference: string) => {
    const currentPreviews = previews.current;
    const existing = currentPreviews.get(reference);
    if (existing) return existing;
    const loading = assetBlob(reference).then(bytes => {
      if (!live.current || previews.current !== currentPreviews) return '/asset-unavailable.svg';
      const url = URL.createObjectURL(bytes);
      previewUrls.current.add(url);
      return url;
    }, error => {
      if (live.current && previews.current === currentPreviews) notify(error);
      return '/asset-unavailable.svg';
    });
    // MDXEditor requests the same preview twice while it initializes the image
    // node. Hold one result per image for this editor mount and retry explicitly.
    currentPreviews.set(reference,loading);
    return loading;
  }, [notify]);

  async function insertImage(file: File) {
    if (uploading) return;
    setUploading(true);
    try {
      if (!canInsertImages) throw Error('STUDENT_IMAGE_FORBIDDEN');
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('UNSUPPORTED_IMAGE');
      const key = uploads.current.get(file) ?? crypto.randomUUID();
      uploads.current.set(file,key);
      const response = await fetch('/api/assets',{ method: 'POST', headers: { 'Content-Type': file.type,
        ...(assignmentId ? { 'X-Garden-Assignment':assignmentId } : { 'X-Garden-Library':libraryId! }), 'Idempotency-Key': key }, body: file });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (!live.current) return;
      attach.current(result.reference);
      setRetryFile(null);
      setMessage('Đã chèn ảnh riêng tư.');
    } catch (error) {
      const code = (error as Error).message;
      if (['DRIVE_UNAVAILABLE','DRIVE_QUOTA','DRIVE_RECONNECT','Failed to fetch'].includes(code)) setRetryFile(file);
      notify(error);
    }
    finally { setUploading(false); }
  }

  function importClipboard(event: ClipboardEvent<HTMLDivElement> | DragEvent<HTMLDivElement>) {
    if (readOnly) return;
    const clipboard = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const files = [...clipboard.files];
    const html = clipboard.getData('text/html');
    const text = clipboard.getData('text/plain');
    if (!html && !text && !files.length) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (files.length) {
        if (files.length !== 1) throw Error('UNSUPPORTED_IMAGE');
        void insertImage(files[0]);
      } else {
        if (/<img\b/i.test(html)) throw Error(canInsertImages ? 'PRIVATE_ASSET_REQUIRED' : 'STUDENT_IMAGE_FORBIDDEN');
        if (!text) return;
        const markdown = prepareMarkdown(text,role);
        lastImport.current = current();
        editor.current?.insertMarkdown(markdown);
      }
    } catch (error) { notify(error); }
  }

  function download() {
    try {
      const { markdown, assets } = inspectMarkdown(current(),role);
      const url = URL.createObjectURL(new Blob([markdown],{ type: 'text/markdown;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'vuon-van.md';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url),0);
      setMessage(assets.length ? 'Đã tải Markdown. Cần quyền trong Vườn Văn để xem ảnh riêng tư.' : 'Đã tải Markdown.');
    } catch (error) { notify(error); }
  }

  async function check() {
    try {
      if (rejected.current) throw Error('EDITOR_IMPORT');
      setChecking(true);
      const response = await fetch('/api/editor/validate',{ method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: current(), assignmentId }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      setMessage('Markdown hợp lệ.');
    } catch (error) { notify(error); }
    finally { setChecking(false); }
  }

  function changeMode() {
    if (mode === 'source') apply(source);
    else { setSource(current()); setMode('source'); }
  }

  const utility = <>
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={download}>Tải Markdown</button>
    {validate && <button type="button" disabled={checking} onClick={check}>Kiểm tra Markdown</button>}
    {retryFile && mode === 'rich' && <button type="button" disabled={uploading} onClick={() => insertImage(retryFile)}>Thử tải ảnh lên lại</button>}
    {canInsertImages && <button type="button" disabled={uploading || mode === 'source'} onClick={() => {
      initialText.current = current();
      previews.current = new Map();
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
      setMessage('');
      setEpoch(value => value + 1);
    }}>Tải lại ảnh</button>}
  </>;
  const sourceInput = mode === 'source' && <textarea className={worksheet ? 'worksheet-source' : undefined}
    rows={12} aria-label="Mã Markdown" value={source} readOnly={readOnly} onChange={event => {
      setSource(event.target.value);
      onMarkdownChange?.(event.target.value);
    }}/>;
  return <div className={worksheet ? 'garden-editor worksheet-editor' : 'garden-editor'} onKeyDownCapture={event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'u') { event.preventDefault(); event.stopPropagation(); notify(Error('UNSUPPORTED_UNDERLINE')); }
    if (event.key.toLowerCase() === 's') { event.preventDefault(); event.stopPropagation(); download(); }
  }}>
    {worksheet ? <WorksheetToolbar actions={worksheetActions} format={format} source={mode === 'source'}
      disabled={Boolean(readOnly || uploading)} toggle={changeMode} menu={utility}
      image={canInsertImages ? () => fileInput.current?.click() : undefined}/> : <div className="app-actions">
      <button type="button" aria-pressed={mode === 'rich'} disabled={uploading} onClick={() => { if (mode === 'source') apply(source); }}>Trực quan</button>
      <button type="button" aria-pressed={mode === 'source'} disabled={uploading} onPointerDown={event => event.preventDefault()} onClick={() => {
        setSource(current()); setMode('source');
      }}>Mã Markdown</button>
      {utility}
    </div>}
    {mode === 'source' && (worksheet ? sourceInput : <label>Mã Markdown{sourceInput}</label>)}
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Chọn ảnh riêng tư" hidden onChange={event => {
      const file = event.target.files?.[0];
      if (file) void insertImage(file);
      event.target.value = '';
    }}/>
    <div hidden={mode === 'source'} onPasteCapture={importClipboard} onDropCapture={importClipboard}>
      <MDXEditor key={epoch} ref={editor} markdown={initialText.current} suppressHtmlProcessing trim={false} readOnly={readOnly}
        contentEditableClassName="garden-editor-text" onError={() => {
          rejected.current = true;
          setSource(lastImport.current);
          setMode('source');
          notify(Error('EDITOR_IMPORT'));
        }} onChange={value => {
          if (!rejected.current && mode === 'rich') {
            setSource(value);
            onMarkdownChange?.(value);
          }
        }} plugins={[
          editorPlugins({ install: (snapshot, insert) => { tableSnapshot.current = snapshot; attach.current = insert; },
            worksheet:worksheet ? { install:actions => { worksheetActions.current = actions; },onFormat:setFormat } : undefined }),
          headingsPlugin(),listsPlugin(),quotePlugin(),tablePlugin(),linkPlugin(),linkDialogPlugin(),
          ...(role === 'teacher' ? [imagePlugin({ imagePreviewHandler: preview, disableImageResize: true,
            allowSetImageDimensions: false, disableImageSettingsButton: true })] : []),
          ...(!worksheet ? [toolbarPlugin({ toolbarClassName:'garden-format-toolbar',toolbarContents: () => <><UndoRedo/><BoldItalicUnderlineToggles options={['Bold','Italic']}/>
            <BlockTypeSelect/><ListsToggle options={['bullet','number']}/><CreateLink/><InsertTable/>
            {canInsertImages && <button type="button" disabled={uploading} onPointerDown={event => event.preventDefault()}
              onClick={() => fileInput.current?.click()}>Chèn ảnh</button>}</> })] : [])
        ]}/>
    </div>
    <p role="status">{message}</p>
  </div>;
}
