import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { database } from '../../server/db';
import { listLibrary } from '../../server/library/items';
import { deletingLibraryItems } from '../../server/library/deletion';
import { AppShell } from '../app-shell';
import { AddLibraryItem, FavoriteLibraryItem, RemoveLibraryItem } from './library-actions';
import './library.css';

const labels = { markdown:'Markdown',pdf:'PDF',text:'TXT' };
export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ favorites?: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  const teacher = user.role === 'teacher';
  const favorites = !teacher && (await searchParams).favorites === '1';
  const [items,drafts,deleting] = await Promise.all([listLibrary(user.id,favorites),teacher ?
    database().query<{ id: string }>("SELECT id FROM garden.library_items WHERE teacher_id=$1 AND state='draft' ORDER BY id",[user.id]).then(result => result.rows) : [],
  teacher ? deletingLibraryItems(user.id) : []]);
  return <AppShell user={user} current="/library" title="Thư viện">
    <section className="app-panel">
      {teacher ? <><AddLibraryItem/>
        {drafts.length > 0 && <ul>{drafts.map(item => <li key={item.id}><Link href={`/library/${item.id}/edit`}>Tiếp tục thêm tài liệu</Link></li>)}</ul>}
      </> : <nav className="app-actions" aria-label="Bộ lọc thư viện">
        <Link className="app-button" href="/library" aria-current={!favorites ? 'page' : undefined}>Tất cả tài liệu</Link>
        <Link className="app-button" href="/library?favorites=1" aria-current={favorites ? 'page' : undefined}>Tài liệu yêu thích</Link>
      </nav>}
      <h2>Tài liệu</h2>
      {items.length ? <ul className="library-list">{items.map(item => <li key={item.id}>
        <div><Link href={`/library/${item.id}`}>{item.title}</Link>{item.format && <p>{labels[item.format]}{item.sourceLabel ? ` · ${item.sourceLabel}` : ''}</p>}</div>
        {!teacher && <FavoriteLibraryItem key={`${item.id}:${item.favorite}`} id={item.id} initial={item.favorite} writable={item.writable}/>}
      </li>)}</ul> : <p>{favorites ? 'Chưa có tài liệu yêu thích nào bạn còn quyền đọc.' : 'Chưa có tài liệu.'}</p>}
    </section>
    {deleting.length > 0 && <section className="app-panel">
      <h2>Đang đối chiếu thùng rác</h2>
      <ul>{deleting.map(item => <li key={item.id}><RemoveLibraryItem id={item.id} version={item.version} pending/></li>)}</ul>
    </section>}
  </AppShell>;
}
