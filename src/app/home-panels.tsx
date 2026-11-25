import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import book from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/vuon-trong-trang-sach.webp';
import inkGarden from '../../docs/research/vuon-van-ca-nhan.pages.dev/source/khu-vuon-trong-lo-muc.webp';
import type { listAssignments } from '../server/assignments/access';
import type { featuredLibrary } from '../server/library/items';
import './progress-home.css';

export function HomeHero({ gardenHref }: { gardenHref?: string }) {
  return <section className="home-hero" aria-label="Một ngày mới trong Vườn Văn">
    <div className="home-hero-copy">
      <div className="home-eyebrow">Một ngày mới trong Vườn Văn</div>
      <h2 className="home-slogan"><span>{gardenHref ? 'Hôm nay,' : 'Nâng niu ý tưởng,'}</span>
        <span>{gardenHref ? 'em gieo điều gì vào trang viết?' : 'Ươm dưỡng tình yêu văn chương'}</span></h2>
      <p>Vườn Văn - Không gian sáng tạo và kết nối</p>
      <div className="home-buttons">
        <Link className="app-button app-primary" href={gardenHref ?? '/assignments?new=1'}>
          {gardenHref ? 'Thăm vườn' : '+ Giao một bài mới'}</Link>
        <Link className="home-link" href="/rubrics">Khám phá rubric ↗</Link>
      </div>
    </div>
    <div className="home-hero-art"><Image className="app-hero-image" src={book} alt="" preload
      sizes="(max-width: 760px) 67vw, (max-width: 1150px) 35vw, 44vw"/></div>
    <span className="home-spark s1" aria-hidden="true">✦</span>
    <span className="home-spark s2" aria-hidden="true">✧</span>
    <span className="home-spark s3" aria-hidden="true">✦</span>
  </section>;
}

export function HomeStats({ classes,students,waiting,name }: { classes: number; students: number; waiting: number; name: string }) {
  const metrics = [
    { icon:'♧',title:'Lớp học',value:classes,caption:'Những khu vườn nhỏ',href:'/classes',summary:`${classes} lớp đang hoạt động.` },
    { icon:'✿',title:'Học sinh',value:students,caption:'Cùng sáng tạo mỗi ngày',href:'/classes' },
    { icon:'✎',title:'Bài chờ chấm',value:waiting,caption:'Những trang viết đang lớn',href:'/reviews?waiting=1',summary:`${waiting} bài viết đang chờ chấm.` },
    { icon:'☼',title:'Chấm bài',value:name,caption:'Chăm chút từng trang viết',href:'/reviews' }
  ];
  return <div className="home-stats">{metrics.map(metric => <Link className="home-stat" key={metric.title}
    href={metric.href} aria-label={metric.title === 'Bài chờ chấm' ? `Xem bài chờ chấm · ${waiting}` : undefined}>
    <i aria-hidden="true">{metric.icon}</i><span>{metric.title}</span>
    <strong>{metric.value}</strong><small>{metric.caption}</small>
    {metric.summary && <span className="visually-hidden">{metric.summary}</span>}
  </Link>)}</div>;
}

export function HomeColumns({ assignments, student, featured }: {
  assignments: Awaited<ReturnType<typeof listAssignments>>; student?: boolean; featured: Awaited<ReturnType<typeof featuredLibrary>>;
}) {
  const open = assignments.filter(item => item.state === 'published' && item.accepting && item.classState === 'active');
  return <div className="home-columns">
    <section className="home-panel">
      <div className="home-section-head"><h2>Những bài viết đang mở</h2><Link className="home-link" href="/assignments">Xem tất cả ↗</Link></div>
      {open.length ? open.map(item => <div className="home-assignment" key={item.id}>
        <span className="home-book" aria-hidden="true">đ</span>
        <div><strong>{item.unavailable ? 'Chưa tải được đề bài' : item.title}</strong>
          <span className="home-tag">{item.className}</span></div>
        <Link className="app-button" href={student ? `/assignments/${item.id}/write` : `/assignments/${item.id}`}>{student ? 'Làm bài ↗' : 'Xem bài ↗'}</Link>
      </div>) : <p className="home-empty">Chưa có bài viết đang mở.</p>}
    </section>
    <aside>
      <section className="home-panel home-library"><Link href="/library"><h3>Ghé thăm Thư viện</h3>
        <p>Xem các tài liệu hướng dẫn và bài văn hay</p></Link>
        {featured.length > 0 && <ul>{featured.map(item => <li key={`${item.classId}:${item.slot}`}>
          <Link href={`/library/${item.id}`} aria-label={`Mở tài liệu · ${item.title}`}>{item.title}</Link>
          <small> · {item.className} · {item.teacherName}</small>
        </li>)}</ul>}
      </section>
      <div className="home-quote">
        <div><blockquote>“Ước mơ mà không kèm theo hành động thì dù hi vọng có cánh cũng không bao giờ bay tới đích”</blockquote>
          <p>(Shakespeare)</p></div>
        <Image alt="Khu vườn trong lọ mực" src={inkGarden} sizes="(max-width: 760px) 95vw, 37vw"/>
      </div>
    </aside>
  </div>;
}

export function HomeDisclosure({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open} className="home-disclosure"><summary>{title}</summary>{children}</details>;
}
