'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RubricSnapshot } from '../../../server/assignments/bundle';
import { reviewAnchor, reviewColors, reviewMessages, reviewTotal, type RangeComment, type ReviewColor, type ReviewDraft,
  type ReviewComment } from '../../../shared/review';
import { ActionDialog } from '../../action-dialog';
import { ReviewDocument, selectedReviewRange } from '../review-document';
import { keepDeviceReview, latestDeviceReview, type DeviceReview } from '../review-device';
import { reviewSuggestions, type WritingSuggestion } from '../review-rules';

type Head = { version: string; hash: string | null; draft: ReviewDraft };
type Attempt = { action: 'save'; key: string; epoch: string; baseVersion: string; draft: ReviewDraft };
const format = new Intl.NumberFormat('vi-VN',{ minimumFractionDigits:2,maximumFractionDigits:2 });
const saved = 'Đã lưu nháp chấm trên Drive.';
const unavailable = new Set(['SUBMISSION_CONFLICT','SUBMISSION_MISSING','SUBMISSION_UNAVAILABLE','SOURCE_UNVERIFIED','CLASS_INACTIVE','DRIVE_INTEGRITY']);
const same = (a: ReviewDraft,b: ReviewDraft) => JSON.stringify(a) === JSON.stringify(b);

export function ReviewWorkbench({ id, teacher, markdown, text, explanation, projectionSha256, rubric, initial }: {
  id: string; teacher: string; markdown: string; text: string; explanation: string; projectionSha256: string; rubric: RubricSnapshot; initial: Head;
}) {
  const path = `/api/submissions/${id}/review`;
  const baseline = useRef(initial);
  const current = useRef(initial.draft);
  const [draft,setDraft] = useState(initial.draft);
  const [epoch,setEpoch] = useState('');
  const [held,setHeld] = useState(false);
  const [blocked,setBlocked] = useState(false);
  const [busy,setBusy] = useState(true);
  const [retry,setRetry] = useState(false);
  const [status,setStatus] = useState('Đang mở quyền sửa nháp chấm…');
  const [device,setDevice] = useState<DeviceReview | null>(null);
  const [deviceError,setDeviceError] = useState(false);
  const [range,setRange] = useState<{ start: number; end: number } | null>(null);
  const [color,setColor] = useState<ReviewColor>('yellow');
  const [note,setNote] = useState<RangeComment | null>(null);
  const [selectionStatus,setSelectionStatus] = useState('');
  const [suggestions,setSuggestions] = useState<WritingSuggestion[] | null>(null);
  const article = useRef<HTMLElement>(null);
  const client = useRef('');
  const branch = useRef('');
  const restored = useRef<string | null>(null);
  const pending = useRef<Attempt | null>(null);
  const working = useRef(false);
  const writer = useRef('');
  const writes = useRef(Promise.resolve());
  const lastChange = useRef(0);
  const firstChange = useRef(0);
  const invalidDraft = useRef(false);
  const autosave = useRef<() => void>(() => {});

  function setWriter(next: string) { writer.current = next; setEpoch(next); }

  async function request<T>(data?: object): Promise<T> {
    const response = await fetch(path,data ? { method:'POST',headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ clientId:client.current,...data }) } : { cache:'no-store' });
    const value = await response.json();
    if (!response.ok) throw Error(value.error);
    return value;
  }

  function persist(key: string, value: ReviewDraft | null) {
    writes.current = writes.current.then(async () => {
      try { await keepDeviceReview(teacher,id,key,value); setDeviceError(false); }
      catch { setDeviceError(true); }
    });
  }

  function edit(next: ReviewDraft) {
    if (!writer.current || same(next,current.current)) return;
    current.current = next;
    setDraft(next);
    lastChange.current = performance.now();
    firstChange.current ||= lastChange.current;
    invalidDraft.current = false;
    persist(branch.current,next);
    if (!pending.current) setStatus('Nháp chấm có thay đổi chưa đồng bộ.');
  }

  function showFailure(code: string) {
    if (unavailable.has(code)) { setBlocked(true); setWriter(''); }
    if (['STALE_WRITER','DRAFT_CHANGED','LEASE_HELD'].includes(code)) { setHeld(true); setWriter(''); }
    setStatus(reviewMessages[code] ?? 'Chưa lưu được nháp chấm. Hãy thử lại.');
  }

  async function claim(action: 'acquire' | 'takeover') {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const grant = await request<{ epoch: string; version: string }>({ action });
      if (action === 'takeover' || grant.version !== baseline.current.version) {
        const fresh = await request<Head>();
        if (!same(current.current,baseline.current.draft)) {
          setDevice({ branch:branch.current,savedAt:Date.now(),draft:current.current });
          branch.current = crypto.randomUUID();
          restored.current = null;
        }
        baseline.current = fresh;
        current.current = fresh.draft;
        setDraft(fresh.draft);
      }
      setWriter(grant.epoch);
      pending.current = null;
      firstChange.current = 0;
      setRetry(false);
      setHeld(false);
      setBlocked(false);
      setStatus(baseline.current.hash ? saved : 'Nháp chấm sẽ tự lưu khi có thay đổi.');
    } catch (error) { showFailure((error as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  useEffect(() => {
    client.current ||= crypto.randomUUID();
    branch.current ||= crypto.randomUUID();
    void latestDeviceReview(teacher,id).then(setDevice,() => setDeviceError(true));
    void claim('acquire');
    const timer = window.setInterval(() => autosave.current(),350);
    return () => window.clearInterval(timer);
  },[teacher,id]);

  useEffect(() => {
    if (!epoch) return;
    const timer = window.setInterval(() => {
      void request({ action:'renew',epoch }).catch(error => {
        if (writer.current === epoch && (unavailable.has(error.message) || error.message === 'STALE_WRITER')) showFailure(error.message);
      });
    },20_000);
    return () => window.clearInterval(timer);
  },[id,epoch]);

  async function save() {
    if (!writer.current || working.current || (!pending.current && same(current.current,baseline.current.draft))) return;
    const attempt = pending.current ?? { action:'save',key:crypto.randomUUID(),epoch:writer.current,baseVersion:baseline.current.version,
      draft:current.current };
    pending.current = attempt;
    working.current = true;
    setBusy(true);
    setStatus('Đang lưu nháp chấm…');
    try {
      await writes.current;
      const result = await request<{ version: string; hash: string; state: string }>(attempt);
      if (writer.current !== attempt.epoch) return;
      if (result.state === 'unknown') { setRetry(true); setStatus('Chưa xác nhận lưu nháp chấm trên Drive.'); return; }
      baseline.current = { version:result.version,hash:result.hash,draft:attempt.draft };
      pending.current = null;
      setRetry(false);
      if (same(current.current,attempt.draft)) {
        firstChange.current = 0;
        persist(branch.current,null);
        if (restored.current) { persist(restored.current,null); restored.current = null; setDevice(null); }
        setStatus(saved);
      } else setStatus('Nháp chấm có thay đổi chưa đồng bộ.');
    } catch (error) {
      const code = (error as Error).message;
      if (writer.current === attempt.epoch) {
        showFailure(code);
        if (['ANCHOR_CONFLICT','INVALID_REVIEW_DRAFT','KEY_REUSED'].includes(code)) {
          pending.current = null;
          invalidDraft.current = true;
          setRetry(false);
        } else if (writer.current) setRetry(true);
      }
    } finally { working.current = false; setBusy(false); }
  }

  useEffect(() => {
    autosave.current = () => {
      const now = performance.now();
      if (!retry && !invalidDraft.current && writer.current && !working.current &&
          (now-lastChange.current >= 2000 || (firstChange.current && now-firstChange.current >= 10000))) void save();
    };
  });

  const editing = !!epoch && !blocked;
  const marks = draft.comments.filter((comment): comment is RangeComment => comment.kind === 'range');
  const overall = draft.comments.find(comment => comment.kind === 'overall');
  const dirty = !same(draft,baseline.current.draft);
  const rememberRange = () => setRange(selectedReviewRange(article.current));

  function updateComment(comment: ReviewComment) {
    edit({ ...draft,comments:[...draft.comments.filter(old => old.id !== comment.id),comment].sort((a,b) => a.id.localeCompare(b.id)) });
  }

  function addMark(withNote: boolean, suggestion?: WritingSuggestion) {
    const selected = suggestion ?? selectedReviewRange(article.current) ?? range;
    const anchor = selected && reviewAnchor(text,projectionSha256,selected.start,selected.end);
    if (!anchor) { setSelectionStatus('Hãy chọn một đoạn trong bài để tô màu hoặc nhận xét.'); return; }
    if (marks.length >= 50) { setSelectionStatus('Bản nộp này đã có 50 đoạn đánh dấu.'); return; }
    const item = { id:crypto.randomUUID(),kind:'range' as const,body:suggestion?.body ?? '',color,anchor };
    if (withNote) setNote(item);
    else updateComment(item);
    setSelectionStatus('');
  }

  const keyboardRanges = useMemo(() => {
    const options = [];
    for (const match of text.matchAll(/[^\t\n]+/g)) {
      if (match[0].trim() && match[0].length <= 2000) options.push(match);
      if (options.length === 50) break;
    }
    return options;
  },[text]);
  return <>
    <div className="review-columns">
      <section className="app-panel">
        <h2>Bài nộp</h2>
        <article ref={article} tabIndex={0} aria-label="Văn bản bài nộp" onPointerUp={rememberRange} onKeyUp={rememberRange}>
          <ReviewDocument source={markdown} marks={marks}/>
        </article>
        {explanation && <><h3>Giải thích của học sinh</h3><p className="review-text">{explanation}</p></>}
        <div className="app-actions review-tools">
          <label>Màu đánh dấu <select disabled={!editing} value={color} onChange={event => setColor(event.target.value as ReviewColor)}>
            {Object.entries(reviewColors).map(([code,label]) => <option key={code} value={code}>{label}</option>)}
          </select></label>
          <button type="button" disabled={!editing} onPointerDown={event => event.preventDefault()} onClick={() => addMark(false)}>Tô màu đoạn chọn</button>
          <button type="button" disabled={!editing} onPointerDown={event => event.preventDefault()} onClick={() => addMark(true)}>Thêm nhận xét</button>
          <button type="button" disabled={!editing} onClick={() => setSuggestions(reviewSuggestions(text))}>Rà lỗi</button>
        </div>
        {keyboardRanges.length > 0 && <details>
          <summary>Chọn đoạn bằng bàn phím</summary>
          <label>Đoạn trong bài <select value={range ? `${range.start}:${range.end}` : ''} disabled={!editing} onChange={event => {
            const [start,end] = event.target.value.split(':').map(Number);
            const anchor = reviewAnchor(text,projectionSha256,start,end);
            window.getSelection()?.removeAllRanges();
            setRange(anchor ? { start,end } : null);
          }}>
            <option value="">Chọn đoạn</option>{keyboardRanges.map(match => <option key={match.index}
              value={`${match.index}:${match.index+match[0].length}`}>{match[0].slice(0,100)}</option>)}
          </select></label>
        </details>}
        {selectionStatus && <p role="status">{selectionStatus}</p>}
        {note && <form className="review-note" onSubmit={event => { event.preventDefault(); updateComment(note); setNote(null); }}>
          <blockquote>{note.anchor.exact}</blockquote>
          <label>Nhận xét cho đoạn chọn<textarea value={note.body} maxLength={3000} disabled={!editing}
            onChange={event => setNote({ ...note,body:event.target.value })}/></label>
          <div className="app-actions"><button className="app-primary" disabled={!editing}>Lưu nhận xét</button>
            <button type="button" onClick={() => setNote(null)}>Hủy</button></div>
        </form>}
        {marks.length > 0 && <section aria-label="Nhận xét theo đoạn">
          {marks.map(mark => <div key={mark.id} className="review-comment">
            <blockquote><mark className={`review-mark-${mark.color}`}>{mark.anchor.exact}</mark></blockquote>
            {mark.body && <p className="review-text">{mark.body}</p>}
            {editing && <div className="app-actions"><button type="button" onClick={() => setNote(mark)}>Sửa nhận xét</button>
              <button type="button" onClick={() => edit({ ...draft,comments:draft.comments.filter(item => item.id !== mark.id) })}>Bỏ đánh dấu</button></div>}
          </div>)}
        </section>}
        {suggestions && <section aria-label="Gợi ý rà lỗi" className="review-note">
          <h3>Gợi ý rà lỗi</h3>
          {suggestions.length ? <ul>{suggestions.map((suggestion,index) => <li key={index}>
            <q>{suggestion.quote.trim() || 'Khoảng trắng'}</q> {suggestion.body}{' '}
            <button type="button" disabled={!editing} onClick={() => addMark(true,suggestion)}>Dùng gợi ý</button>
          </li>)}</ul> : <p>Chưa thấy dấu hiệu theo các quy tắc đang dùng.</p>}
        </section>}
      </section>
      <section className="app-panel" aria-label="Điểm theo rubric">
        <h2>Điểm theo rubric</h2>
        <p>{rubric.label} · Thang {format.format(Number(rubric.scale))} điểm</p>
        {rubric.criteria.map(criterion => <label key={criterion.id} className="review-criterion">{criterion.label}
          <select disabled={!editing} value={draft.scores.find(item => item.criterionId === criterion.id)?.levelId ?? ''} onChange={event => {
            const chosen = criterion.levels.find(level => level.id === event.target.value);
            edit({ ...draft,scores:rubric.criteria.flatMap(item => {
              if (item.id === criterion.id) return chosen ? [{ criterionId:item.id,levelId:chosen.id,value:chosen.score }] : [];
              const existing = draft.scores.find(entry => entry.criterionId === item.id);
              return existing ? [existing] : [];
            }) });
          }}>
            <option value="">Chưa chấm</option>
            {criterion.levels.map(level => <option key={level.id} value={level.id}>{format.format(Number(level.score))} điểm · {level.description}</option>)}
          </select>
        </label>)}
        <label>Nhận xét chung (không bắt buộc)<textarea disabled={!editing} maxLength={3000} value={overall?.body ?? ''}
          onChange={event => {
            const body = event.target.value;
            const id = body.trim() ? overall?.id ?? crypto.randomUUID() : null;
            const comments = draft.comments.filter(comment => comment.kind !== 'overall');
            edit({ ...draft,overallCommentId:id,
              comments:(id ? [...comments,{ id,kind:'overall' as const,body }] : comments).sort((a,b) => a.id.localeCompare(b.id)) });
          }}/></label>
        <p>{draft.scores.length}/{rubric.criteria.length} tiêu chí đã chấm · {format.format(reviewTotal(draft.scores,rubric))} / {format.format(Number(rubric.scale))} điểm</p>
        <p role={blocked ? 'alert' : 'status'}>{status}</p>
        {deviceError && <p role="alert">Chưa lưu được bản nháp trên thiết bị.</p>}
        <div className="app-actions">
          {editing && <button type="button" disabled={busy || (!dirty && !retry)} onClick={() => void save()}>{retry ? 'Thử lưu lại' : 'Lưu nháp chấm'}</button>}
          {held && <ActionDialog trigger="Tiếp tục chấm tại đây" title="Chuyển quyền sửa nháp chấm"
            detail="Phiên trước có thể còn thay đổi chưa đồng bộ. Phiên này sẽ mở bản đã lưu gần nhất trên Drive."
            confirmLabel="Chuyển quyền chấm" inactive={busy} onConfirm={() => claim('takeover')}/>}
          {!editing && !blocked && !held && !busy && <button type="button" onClick={() => claim('acquire')}>Thử mở quyền chấm</button>}
          {blocked && <a href={`/reviews/${id}`}>Mở lại bàn chấm</a>}
          {device && editing && !dirty && <ActionDialog trigger="Khôi phục nháp chấm trên thiết bị" title="Khôi phục nháp trên thiết bị"
            detail="Các chỉnh sửa trong bản lưu trên thiết bị sẽ được đưa vào bàn chấm này." confirmLabel="Khôi phục nháp chấm"
            inactive={busy} onConfirm={async () => { restored.current = device.branch; edit(device.draft); }}/>}
        </div>
      </section>
    </div>
  </>;
}
