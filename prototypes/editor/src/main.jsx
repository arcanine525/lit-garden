import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, tablePlugin, linkPlugin, linkDialogPlugin, imagePlugin, toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, InsertTable, CreateLink, InsertImage } from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import './style.css';
import { hardBreakPlugin } from './hard-break-plugin.js';
import { validateMarkdown, prepareEditorMarkdown, projectMarkdown, sha256, semantic } from './markdown.js';
import { makeAnchor, writeReview, readReview, restoreReview, schema } from './review.js';
import { sample, cases } from './fixtures.js';
async function api(path, data, options = {}) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), ...options });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
async function preview(src) {
  if (!/^\/api\/assets\/[\w-]+$/.test(src)) throw Error('PRIVATE_ASSET_REQUIRED');
  // A short-lived view is requested again on remount/retry. It is never saved.
  try { return (await api(`${src}/lease`, {})).url; }
  catch (e) { window.dispatchEvent(new CustomEvent('asset-error', { detail: e.message })); return '/unavailable.svg'; }
}
async function upload(file) {
  return (await api('/api/assets', null, { headers: { 'Content-Type': file.type }, body: file })).reference;
}
function RenderedSubmission({ source, annotations }) {
  const { tree } = projectMarkdown(source);
  let key = 0;
  function run(r) {
    if (!r) return null;
    const cuts = [...new Set([r.start, r.end, ...annotations.flatMap((a) => [a.anchor.start, a.anchor.end]).filter((p) => p > r.start && p < r.end)])].sort((a,b) => a-b);
    return <span key={key++} data-start={r.start} data-end={r.end}>{cuts.slice(0,-1).map((start,i) => {
      const end=cuts[i+1], active=annotations.filter((a) => a.anchor.start <= start && a.anchor.end >= end);
      const value=r.value.slice(start-r.start,end-r.start);
      return active.length ? <mark key={start} data-annotation={active.map((a)=>a.id).join(' ')} className={active[0].color} title={active.map((a)=>a.comment).join('\n')}>{value}</mark> : <React.Fragment key={start}>{value}</React.Fragment>;
    })}</span>;
  }
  function render(n) {
    if (n.run) return run(n.run);
    if (n.type === 'tableRow') return <tr key={key++}>{n.children.map((cell,index)=><td key={key++}>{cell.children?.map(render)}{run(cell.suffix)}{index===n.children.length-1?run(n.suffix):null}</td>)}</tr>;
    const children=n.children?.map(render), suffix=run(n.suffix), k=key++;
    const tag={ paragraph:'p', strong:'strong', emphasis:'em', blockquote:'blockquote', listItem:'li', tableRow:'tr', tableCell:'td' }[n.type];
    if (tag) return React.createElement(tag,{key:k},children,suffix);
    if (n.type==='heading') return React.createElement(`h${n.depth}`,{key:k},children,suffix);
    if (n.type==='list') return React.createElement(n.ordered?'ol':'ul',{key:k,start:n.ordered?n.start:undefined},children);
    if (n.type==='table') return <table key={k}><tbody>{children}</tbody></table>;
    if (n.type==='link') return <a key={k} href={n.url} rel="noreferrer">{children}</a>;
    if (n.type==='definition') return null;
    return <React.Fragment key={k}>{children}{suffix}</React.Fragment>;
  }
  return render(tree);
}
function App() {
  const importError=useRef(null), importSource=useRef(sample);
  const editor=useRef(null), [role,setRole]=useState(null), [mode,setMode]=useState('rich'), [source,setSource]=useState(sample), [status,setStatus]=useState(''), [epoch,setEpoch]=useState(0);
  const [reviewSource,setReviewSource]=useState(''), [annotations,setAnnotations]=useState([]), [selection,setSelection]=useState(null), [comment,setComment]=useState('Hình ảnh gợi cảm, em hãy phát triển thêm.'), [reviewStatus,setReviewStatus]=useState('Chưa nạp review'), [changed,setChanged]=useState(false), [reviewOverall,setReviewOverall]=useState('Bài viết giàu hình ảnh.');
  useEffect(()=>{ api('/api/mock/login',{role:'teacher'}).then(()=>setRole('teacher')); const onError=(e)=>setStatus(e.detail); window.addEventListener('asset-error',onError); return ()=>window.removeEventListener('asset-error',onError); },[]);
  async function changeRole(next) { await api('/api/mock/login',{role:next}); importError.current=null; importSource.current=sample; setRole(next); setMode('rich'); setSource(sample); setEpoch((n)=>n+1); setStatus('Đã đổi vai mock'); }
  function onImportError({error,source:failedSource}) {
    importError.current=error;
    setSource(importSource.current ?? failedSource);
    setMode('source');
    setStatus(`EDITOR_IMPORT: ${error}`);
  }
  function importToEditor(md, original=md) {
    const recovering=importError.current!==null;
    importError.current=null; importSource.current=original;
    if (recovering) {
      // A failed import may retain the same markdown$ and skip the next setMarkdown.
      // Remount on recovery so we cannot treat that retained source as a rich tree.
      setSource(md); setEpoch(n=>n+1);
    } else {
      editor.current.setMarkdown(md);
      if (importError.current) return false;
      setSource(md);
    }
    setMode('rich'); setStatus('Markdown hợp lệ'); return true;
  }
  function apply(md=source) { try { return importToEditor(prepareEditorMarkdown(md,role),md); } catch(e) { setSource(md); setMode('source'); setStatus(e.message); return false; } }
  function keyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); e.stopPropagation(); setStatus('UNSUPPORTED_UNDERLINE'); }
  }
  function paste(e) {
    const data=e.clipboardData ?? e.dataTransfer;
    if (!data) return;
    const files=[...data.files];
    // Drop text is handled as plain text too; no HTML importer is allowed through.
    if (files.length) {
      if (role!=='teacher' || files.some((f)=>f.type!=='image/png')) { e.preventDefault(); e.stopPropagation(); setStatus('STUDENT_IMAGE_FORBIDDEN hoặc PNG_REQUIRED'); }
      return;
    }
    const text=data.getData('text/plain'), html=data.getData('text/html');
    if (html || text) {
      e.preventDefault(); e.stopPropagation();
      try {
        if (html && /<img\b/i.test(html)) throw Error(role==='teacher'?'PRIVATE_ASSET_REQUIRED':'STUDENT_IMAGE_FORBIDDEN');
        const markdown=prepareEditorMarkdown(text,role);
        importSource.current=editor.current.getMarkdown();
        editor.current.insertMarkdown(markdown);
        if (!importError.current) setStatus('Đã dán Markdown đã kiểm tra');
      } catch(error) { setStatus(error.message); }
    }
  }
  async function persist() {
    try { if (importError.current) throw Error('EDITOR_IMPORT_FAILED'); const markdown=mode==='source'?source:editor.current.getMarkdown(); validateMarkdown(markdown,role); await api('/api/documents',{markdown}); setStatus('API mock đã nhận; chưa lưu Drive'); } catch(e) { setStatus(e.message); }
  }
  function selectText() {
    const s=window.getSelection(); if (!s?.rangeCount || s.isCollapsed) return;
    const range=s.getRangeAt(0);
    function position(container,offset) {
      const span=(container.nodeType===3?container.parentElement:container).closest('[data-start]');
      if (!span) return null;
      const r=document.createRange(); r.selectNodeContents(span); r.setEnd(container,offset);
      return Number(span.dataset.start)+r.toString().length;
    }
    const start=position(range.startContainer,range.startOffset), end=position(range.endContainer,range.endOffset);
    if (start!==null && end>start) setSelection({start,end});
  }
  async function saveReview() {
    try {
      if (role !== 'teacher') throw Error('TEACHER_ONLY');
      if (!selection) throw Error('Hãy chọn một đoạn bài gốc');
      const contentHash=await sha256(sample), anchor=await makeAnchor(sample,selection.start,selection.end);
      const r={schema,id:'review-1',kind:'publication',submissionId:'submission-1',version:1,contentHash, scores:[{criterionId:'images',value:2,max:2}],overall:reviewOverall,annotations:[{id:'annotation-1',color:'yellow',comment,anchor}]};
      const md=writeReview(r); setReviewSource(md); localStorage.setItem('PROTOTYPE-review.md',md);
      await loadReview(md); setReviewStatus('Đã ghi review Markdown cục bộ và phục hồi');
    } catch(e) { setReviewStatus(e.message); }
  }
  async function loadReview(md=reviewSource || localStorage.getItem('PROTOTYPE-review.md')) {
    try {
      if (!md) throw Error('Chưa có review Markdown');
      const r=readReview(md); const result=await restoreReview(r,{id:'submission-1',version:1,contentHash:await sha256(sample)},changed?sample+'\nNội dung bị đổi.':sample);
      setReviewSource(md); setAnnotations(result.annotations); setReviewOverall(r.overall); setReviewStatus(result.status);
    } catch(e) { setAnnotations([]); setReviewStatus(e.message); }
  }
  useEffect(()=>{ if (localStorage.getItem('PROTOTYPE-review.md')) loadReview(localStorage.getItem('PROTOTYPE-review.md')); },[changed]);
  // Deliberately exposed only in the local spike for deterministic DOM probes.
  window.spike={ cases, semantic, projectMarkdown, validateMarkdown, get:()=>editor.current?.getMarkdown(), set:(md)=>apply(md), role:changeRole, ready:!!role, review:()=>reviewSource,
    importError:()=>importError.current, probeImport:(md)=>importToEditor(md) };
  if (!role) return <p>Đang mở prototype…</p>;
  return <main><header><small>SPIKE · LOCAL MOCK · KHÔNG LƯU DRIVE</small><h1>Vườn Văn · Kiểm chứng editor</h1><p>MDXEditor 4.5.0 · Ảnh và tài khoản bên dưới đều là mock.</p><label>Vai thử nghiệm <select aria-label="Vai thử nghiệm" value={role} onChange={(e)=>changeRole(e.target.value)}><option value="teacher">Giáo viên</option><option value="student">Học sinh</option></select></label></header>
    <section><h2>Trực quan ↔ Markdown</h2><div className="actions"><button onClick={()=>{if (!importError.current && mode!=='source') setSource(editor.current.getMarkdown());setMode('source');}}>Mã Markdown</button><button onClick={()=>apply()}>Áp dụng nguồn</button><button onClick={persist}>Kiểm tra lưu qua API mock</button>{role==='teacher'&&<button onClick={()=>apply(editor.current.getMarkdown()+'\n\n![Hoa riêng tư](/api/assets/flower)')}>Chèn ảnh mock</button>}<button onClick={()=>setEpoch((n)=>n+1)}>Tải lại URL ảnh</button></div>
    {mode==='source'&&<label>Nguồn Markdown<textarea aria-label="Nguồn Markdown" value={source} onChange={(e)=>setSource(e.target.value)}/></label>}
    <div style={{display:mode==='source'?'none':'block'}} onPasteCapture={paste} onDropCapture={paste} onKeyDownCapture={keyDown}><MDXEditor key={`${role}-${epoch}`} ref={editor} markdown={source} suppressHtmlProcessing trim={false} contentEditableClassName="essay" onChange={(md)=>{if (!importError.current) setSource(md);}} onError={onImportError} plugins={[
      hardBreakPlugin(),headingsPlugin(),listsPlugin(),quotePlugin(),tablePlugin(),linkPlugin(),linkDialogPlugin(),
      ...(role==='teacher'?[imagePlugin({imageUploadHandler:upload,imagePreviewHandler:preview,disableImageResize:true,allowSetImageDimensions:false,disableImageSettingsButton:true})]:[]),
      toolbarPlugin({toolbarContents:()=> <><UndoRedo/><BoldItalicUnderlineToggles options={['Bold','Italic']}/><BlockTypeSelect/><ListsToggle options={['bullet','number']}/><CreateLink/><InsertTable/>{role==='teacher'&&<InsertImage/>}</>})
    ]}/></div><output aria-label="Trạng thái editor">{status}</output></section>
    <section><h2>Khôi phục đánh dấu từ review Markdown</h2><p>Bài gốc cố định để chấm; chọn văn bản, ghi góp ý rồi tải lại trang. Tệp review là nguồn phục hồi duy nhất.</p><article data-testid="submission" className="essay" onMouseUp={selectText}><RenderedSubmission source={changed?sample+'\nNội dung bị đổi.':sample} annotations={annotations}/></article>
    <p>Vùng chọn UTF-16: {selection?`${selection.start}–${selection.end}`:'Chưa chọn'}</p><label>Góp ý<textarea aria-label="Góp ý" value={comment} onChange={(e)=>setComment(e.target.value)}/></label><label>Nhận xét chung<input aria-label="Nhận xét chung" value={reviewOverall} onChange={(e)=>setReviewOverall(e.target.value)}/></label>
    <div className="actions"><button disabled={role!=='teacher'} onClick={saveReview}>Ghi review Markdown cục bộ</button><button onClick={()=>loadReview()}>Nạp review Markdown</button><button disabled={role!=='teacher'} onClick={()=>setChanged((v)=>!v)}>Đổi/khôi phục nội dung gốc</button><button onClick={()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([reviewSource],{type:'text/markdown'}));a.href=url;a.download='prototype.review.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}}>Tải .review.md</button></div>
    <output aria-label="Trạng thái review">{reviewStatus}</output>{annotations.map((a)=><p key={a.id}><mark className={a.color}>{a.anchor.exact}</mark> — {a.comment}</p>)}<details><summary>Review Markdown (YAML + phần đọc được)</summary><textarea aria-label="Review Markdown" value={reviewSource} onChange={(e)=>setReviewSource(e.target.value)}/></details></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
