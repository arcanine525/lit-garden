'use client';

import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react';
import './focus-clock.css';

type Clock = { elapsed: number; since: number | null; goal: number; open: boolean; started: boolean };
export type FocusClockHandle = { pause(): void };
const initial: Clock = { elapsed:0,since:null,goal:30,open:false,started:false };
const stages = ['Mầm','Chồi','Nụ','Hoa'];
const elapsedTime = (clock: Clock, now: number) => clock.elapsed + (clock.since === null ? 0 : Math.max(0,now-clock.since));

function plant(stage: number) {
  const paths = [
    <><path d="M25 41q0-10-6-14"/><path fill="#9ecf74" d="M20 31Q9 31 9 22q10-2 11 9Z"/></>,
    <><path d="M25 41V20"/><path fill="#82bd76" d="M25 32Q11 31 10 20q12 0 15 12Zm0-7Q26 13 39 13q-1 11-14 12Z"/></>,
    <><path d="M25 41V18m0 15q9-1 12-8-9-1-12 8"/><path fill="#f19d9e" d="M25 23q-12-10 0-20 12 10 0 20Z"/></>,
    <><path d="M25 41V17m0 16q9-1 12-8-9-1-12 8"/><g fill="#f6a0a5">
      {[0,72,144,216,288].map(angle => <ellipse key={angle} cx="25" cy="8" rx="5" ry="7" transform={`rotate(${angle} 25 16)`}/>)}
    </g><circle cx="25" cy="16" r="5" fill="#ffd574"/></>
  ];
  return <svg aria-hidden="true" viewBox="0 0 50 52" width="54" height="56" fill="none" stroke="#446c4d" strokeWidth="1.5">
    {paths[stage]}<path fill="#dca17c" d="M14 39h23l-4 12H18Z"/>
  </svg>;
}

function restore(key: string): Clock {
  try {
    const clock = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Clock | null;
    if (clock && Number.isFinite(clock.elapsed) && clock.elapsed >= 0 && (clock.since === null || Number.isFinite(clock.since)) &&
      Number.isInteger(clock.goal) && clock.goal >= 1 && clock.goal <= 240 && typeof clock.open === 'boolean' &&
      typeof clock.started === 'boolean') return clock;
  } catch { /* The timer remains usable when session storage is unavailable. */ }
  return initial;
}

export function FocusClock({ student, assignment, clockRef }: { student: string; assignment: string; clockRef: Ref<FocusClockHandle> }) {
  const storageKey = `garden:focus-clock:${student}:${assignment}`;
  const panelId = useId();
  const titleId = useId();
  const current = useRef(initial);
  const [clock,setClock] = useState(initial);
  const [now,setNow] = useState(0);
  const [goal,setGoal] = useState(String(initial.goal));
  const [ready,setReady] = useState(false);

  useEffect(() => {
    const saved = restore(storageKey);
    current.current = saved;
    setClock(saved);
    setGoal(String(saved.goal));
    setNow(Date.now());
    setReady(true);
  },[storageKey]);

  useEffect(() => {
    if (!clock.open || clock.since === null) return;
    const tick = window.setInterval(() => setNow(Date.now()),500);
    return () => window.clearInterval(tick);
  },[clock.open,clock.since]);

  function update(next: Clock, at = Date.now()) {
    current.current = next;
    setClock(next);
    setNow(at);
    try { sessionStorage.setItem(storageKey,JSON.stringify(next)); }
    catch { /* Elapsed time is still available in the current page. */ }
  }

  function pause() {
    if (current.current.since === null) return;
    const at = Date.now();
    update({ ...current.current,elapsed:elapsedTime(current.current,at),since:null },at);
  }

  useImperativeHandle(clockRef,() => ({ pause }));

  function toggle() {
    const active = current.current;
    const at = Date.now();
    update({ ...active,open:!active.open,started:true,since:active.started ? active.since : at },at);
  }

  function setTarget(input: string) {
    const value = Math.max(1,Math.min(240,Math.round(Number(input) || initial.goal)));
    setGoal(String(value));
    update({ ...current.current,goal:value });
  }

  const ms = elapsedTime(clock,now);
  const seconds = Math.floor(ms/1000);
  const time = [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(part => String(part).padStart(2,'0')).join(':');
  const stage = Math.min(3,Math.floor(3*ms/(clock.goal*60_000)));

  return <div className="focus-clock">
    <button type="button" className="focus-clock-toggle" aria-expanded={clock.open} aria-controls={panelId} disabled={!ready} onClick={toggle}>
      <span aria-hidden="true">◷</span> {clock.open ? 'Ẩn đồng hồ làm bài' : 'Bật đồng hồ làm bài'}
    </button>
    <section id={panelId} className="focus-clock-panel" aria-labelledby={titleId} hidden={!clock.open}>
      {plant(stage)}
      <div className="focus-clock-content">
        <h2 id={titleId}>Đồng hồ tập trung</h2>
        <div><strong role="timer" aria-label="Thời gian tập trung">{time}</strong> · <span role="status">{stages[stage]}</span></div>
        <label>Mốc nở hoa (phút)<input type="number" min="1" max="240" step="1" value={goal}
          onChange={event => setGoal(event.target.value)} onBlur={event => setTarget(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/></label>
        <div className="app-actions">
          <button type="button" onClick={() => {
            if (current.current.since !== null) pause();
            else update({ ...current.current,since:Date.now() });
          }}>{clock.since !== null ? 'Tạm dừng' : clock.elapsed > 0 ? 'Tiếp tục' : 'Bắt đầu'}</button>
          <button type="button" onClick={() => update({ ...current.current,elapsed:0,since:null })}>Đặt lại</button>
        </div>
      </div>
    </section>
  </div>;
}
