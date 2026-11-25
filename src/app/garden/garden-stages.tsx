'use client';

import Image from 'next/image';
import { useState, type ReactNode } from 'react';
import sprout from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-sprout.webp';
import flower from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-flower.webp';
import fruit from '../../../docs/research/vuon-van-ca-nhan.pages.dev/source/garden-fruit.webp';

const stages = [
  { id:'sprout',title:'Mầm',label:'bài đang viết',image:sprout },
  { id:'flower',title:'Hoa',label:'bài chờ góp ý',image:flower },
  { id:'fruit',title:'Quả',label:'bài đã nhận xét',image:fruit }
] as const;

type Stage = typeof stages[number]['id'];

export function GardenStages({ counts, lists, filters }: {
  counts: Record<Stage,number>; lists: Record<Stage | 'all',ReactNode>; filters: ReactNode;
}) {
  const [selected,setSelected] = useState<Stage | 'all'>('all');
  const current = stages.find(stage => stage.id === selected);
  return <>
    <p className="garden-intro">Mỗi đề được tính một lần, theo bản nộp gần nhất.</p>
    <div className="garden-cards" role="group" aria-label="Khu vườn bài viết">
      {stages.map(({ id,title,image,label }) => <section key={id} aria-label={title}>
        <button type="button" className={`garden-stage ${id}`} aria-pressed={selected === id}
          aria-controls="garden-assignment-list" onClick={() => setSelected(id)}>
          <Image className="garden-card-art" src={image} alt="" sizes="(max-width: 600px) 41vw, (max-width: 1150px) 22vw, 27vw"/>
          <span className="garden-card-caption"><span className="garden-stage-name">{title}</span>
            <span className="garden-stage-summary"><span className="garden-stage-count">{counts[id]} <span className="garden-stage-unit">bài</span></span>
              <span className="garden-stage-label">{label.slice(4)}</span></span>
            <span aria-hidden="true" className="garden-card-arrow">↗</span>
          </span>
        </button>
      </section>)}
    </div>
    <section className="home-panel garden-list" id="garden-assignment-list" aria-labelledby="garden-list-title">
      <div className="home-section-head"><h2 id="garden-list-title" aria-live="polite">{current ? `${current.title} · ${current.label}` : 'Bài được giao'}</h2>
        <button type="button" className="home-link" onClick={() => setSelected('all')}>Xem tất cả ↗</button></div>
      {lists[selected]}
      {filters}
    </section>
  </>;
}
