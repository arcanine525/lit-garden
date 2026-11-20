'use client';

import { useState, type FormEvent } from 'react';
import type { Rubric, RubricCriterion, RubricLevel } from '../../server/rubrics/definition';

const revisionKey = (rubric: Rubric) => `${rubric.id}:${rubric.revision}`;
const point = (value: string) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value));
const newLevel = (score = ''): RubricLevel => ({ id: crypto.randomUUID(), score, description: '' });
const newCriterion = (): RubricCriterion => ({
  id: crypto.randomUUID(), label: '', group: '', max: '', levels: [newLevel(), newLevel('0')]
});

export function RubricCatalog({ initial, editable }: { initial: Rubric[]; editable: boolean }) {
  const [rubrics, setRubrics] = useState(initial);
  const [selected, setSelected] = useState(initial[0] ? revisionKey(initial[0]) : '');
  const [draft, setDraft] = useState<Rubric | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const rubric = rubrics.find(item => revisionKey(item) === selected);
  const current = rubric && !rubric.retired && !rubrics.some(item => item.id === rubric.id && item.revision > rubric.revision);

  function startNew() {
    setMessage('');
    setDraft({ id: crypto.randomUUID(), revision: 0, label: '', retired: false,
      definition: { max: '', criteria: [newCriterion()] } });
  }

  async function change(action: 'create' | 'revise' | 'retire', target: Rubric) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/rubrics', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: target.id, expectedRevision: target.revision,
          label: target.label, definition: target.definition })
      });
      if (!response.ok) {
        const { error } = await response.json();
        setMessage(error === 'RUBRIC_CHANGED' ? 'Rubric đã thay đổi. Tải lại trang để xem phiên bản mới.' :
          error === 'INVALID_RUBRIC' ? 'Mỗi tiêu chí cần tên, mức điểm khác nhau, mô tả và điểm tối đa lớn hơn 0.' :
          'Chưa lưu được rubric. Hãy thử lại.');
        return;
      }
      const updated: Rubric = await response.json();
      setRubrics(items => [...items.filter(item => revisionKey(item) !== revisionKey(updated)), updated]
        .sort((a,b) => a.label.localeCompare(b.label, 'vi') || b.revision - a.revision));
      setSelected(revisionKey(updated));
      setDraft(null);
      setMessage(action === 'retire' ? 'Đã ngừng dùng rubric.' : 'Đã lưu phiên bản rubric.');
    } catch {
      setMessage('Chưa lưu được rubric. Hãy thử lại.');
    } finally {
      setBusy(false);
    }
  }

  function editCriteria(criteria: RubricCriterion[]) {
    setDraft(value => value && { ...value, definition: { ...value.definition, criteria } });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft) void change(draft.revision ? 'revise' : 'create', draft);
  }

  return <>
    <div className="app-actions rubric-choices" role="group" aria-label="Bộ rubric">
      {rubrics.map(item => {
        const key = revisionKey(item);
        const revisions = editable && rubrics.some(other => other.id === item.id && other.revision !== item.revision);
        return <button type="button" key={key} aria-pressed={selected === key} disabled={busy} onClick={() => {
          setSelected(key);
          setMessage('');
        }}>{item.label}{revisions ? ` · v${item.revision}` : ''}{item.retired ? ' · Đã ngừng dùng' : ''}</button>;
      })}
    </div>
    {!rubrics.length && <p>Chưa có rubric.</p>}
    {rubric && <section className="app-panel rubric-definition" aria-labelledby="rubric-name" key={selected}>
      <h2 id="rubric-name">{rubric.label}</h2>
      <span className="rubric-scale">Thang chuẩn {point(rubric.definition.max)} điểm</span>
      {editable && <span className="rubric-revision">Phiên bản {rubric.revision}{rubric.retired ? ' · Đã ngừng dùng' : ''}</span>}
      {editable && current && <div className="app-actions rubric-controls">
        <button type="button" disabled={busy || !!draft} onClick={() => { setMessage(''); setDraft(rubric); }}>Tạo phiên bản mới</button>
        <button type="button" disabled={busy || !!draft} onClick={() => change('retire', rubric)}>Ngừng dùng</button>
      </div>}
      {rubric.definition.criteria.map(criterion => <details key={criterion.id}>
        <summary>{criterion.label}</summary>
        <p>{criterion.group ? `${criterion.group} · ` : ''}Tối đa {point(criterion.max)} điểm</p>
        <dl>{criterion.levels.map(level => <div key={level.id}>
          <dt>{point(level.score)} điểm</dt><dd>{level.description}</dd>
        </div>)}</dl>
      </details>)}
    </section>}
    {editable && <p><button type="button" disabled={busy || !!draft} onClick={startNew}>Tạo rubric</button></p>}
    {draft && <form className="app-panel" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}>
        <legend>{draft.revision ? 'Phiên bản mới' : 'Rubric mới'}</legend>
        <label>Tên rubric <input value={draft.label} required maxLength={150}
          onChange={event => setDraft({ ...draft, label: event.target.value })}/></label>
        {draft.definition.criteria.map((criterion,index,criteria) => {
          const update = (fields: Partial<RubricCriterion>) => editCriteria(criteria.map(item => item.id === criterion.id ? { ...item, ...fields } : item));
          return <fieldset key={criterion.id}>
            <legend>Tiêu chí {index + 1}</legend>
            <label>Tên tiêu chí <input value={criterion.label} required maxLength={250} onChange={event => update({ label: event.target.value })}/></label>{' '}
            <label>Nhóm <input value={criterion.group ?? ''} maxLength={250} onChange={event => update({ group: event.target.value })}/></label>
            {criterion.levels.map((level, levelIndex, levels) => {
              const updateLevel = (fields: Partial<RubricLevel>) => update({ levels: levels.map(item => item.id === level.id ? { ...item, ...fields } : item) });
              return <fieldset key={level.id}>
                <legend>Mức {levelIndex + 1}</legend>
                <label>Điểm <input value={level.score} required inputMode="decimal" maxLength={9}
                  onChange={event => updateLevel({ score: event.target.value })}/></label>{' '}
                <label>Mô tả <textarea value={level.description} required maxLength={4000}
                  onChange={event => updateLevel({ description: event.target.value })}/></label>{' '}
                <button type="button" disabled={levels.length === 1}
                  onClick={() => update({ levels: levels.filter(item => item.id !== level.id) })}>Bỏ mức này</button>
              </fieldset>;
            })}
            <button type="button" disabled={criterion.levels.length >= 50}
              onClick={() => update({ levels: [...criterion.levels, newLevel()] })}>Thêm mức điểm</button>{' '}
            <button type="button" disabled={criteria.length === 1}
              onClick={() => editCriteria(criteria.filter(item => item.id !== criterion.id))}>Bỏ tiêu chí này</button>
          </fieldset>;
        })}
        <p><button type="button" disabled={draft.definition.criteria.length >= 100}
          onClick={() => editCriteria([...draft.definition.criteria, newCriterion()])}>Thêm tiêu chí</button></p>
        <button>Lưu rubric</button>{' '}
        <button type="button" onClick={() => setDraft(null)}>Hủy</button>
      </fieldset>
    </form>}
    <p role="status">{message}</p>
  </>;
}
