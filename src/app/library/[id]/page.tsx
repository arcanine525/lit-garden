import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentSession } from '../../../server/auth/session';
import { database } from '../../../server/db';
import { DriveError } from '../../../server/drive/provider';
import { librarySharing } from '../../../server/library/access';
import { libraryText } from '../../../server/library/format';
import { confirmLibraryVersion, readLibraryFile, readLibraryItem } from '../../../server/library/items';
import { isId } from '../../../server/student-drafts/http';
import { AppShell } from '../../app-shell';
import { MarkdownDocument } from '../../editor/markdown-document';
import { FavoriteLibraryItem, LibrarySharing, RemoveLibraryItem } from '../library-actions';
import '../../editor/editor.css';
import '../library.css';

export default async function LibraryReader({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) redirect('/');
  if (session.user.role === 'admin') notFound();
  const { id:raw } = await params;
  if (!isId(raw)) notFound();
  const id = raw.toLowerCase(), { user } = session;
  let item;
  let share = null;
  let favorite = { saved:false,writable:false };
  let text = '';
  try {
    item = await readLibraryItem(user.id,id);
    if (item.manifest.format === 'text') text = libraryText((await readLibraryFile(user.id,id,item)).bytes);
    if (user.role === 'teacher') share = await librarySharing(user.id,id);
    else {
      const { rows:[state] } = await database().query<{ saved: boolean; writable: boolean }>(`
        SELECT f.item_id IS NOT NULL AS saved,owner.status='active' AS writable FROM garden.users owner
        LEFT JOIN garden.library_favorites f ON f.item_id=$1 AND f.user_id=$2 WHERE owner.id=$3`,
      [id,user.id,item.row.teacher_id]);
      favorite = state;
    }
    await confirmLibraryVersion(user.id,item.row);
  } catch (error) {
    if (error instanceof DriveError && error.code === 'NOT_FOUND') notFound();
    return <AppShell user={user} current="/library" title="Thư viện"><p role="alert">Chưa đọc được tài liệu trên Drive.</p>
      {user.role === 'teacher' && error instanceof DriveError && ['DRIVE_SETUP_REQUIRED','DRIVE_RECONNECT'].includes(error.code) &&
        <p><Link className="app-button app-primary" href="/drive">Kết nối lại Google Drive</Link></p>}
      <Link href={`/library/${id}`}>Thử lại</Link></AppShell>;
  }
  const teacher = user.role === 'teacher';
  if ((await currentSession())?.sessionDigest !== session.sessionDigest) redirect('/');
  const { manifest,markdown } = item;
  const download = `/api/library/${id}/download`;
  const metadata = [manifest.category,manifest.author,manifest.sourceLabel].filter(Boolean).join(' · ');
  return <AppShell user={user} current="/library" title={manifest.title}>
    {metadata && <p>{metadata}</p>}
    {manifest.excerpt && <p className="library-text">{manifest.excerpt}</p>}
    <section className="app-panel" aria-label="Nội dung tài liệu">
      <div className="app-actions library-reader-actions">
        <Link className="app-button" href="/library">Về thư viện</Link>
        <a href={download} className="app-button">Tải tài liệu</a>
        {teacher && <Link className="app-button" href={`/library/${id}/edit`}>Sửa tài liệu</Link>}
        {!teacher && <FavoriteLibraryItem id={id} initial={favorite.saved} writable={favorite.writable}/>}
      </div>
      {manifest.format === 'pdf' ? <iframe className="library-pdf" title="Tài liệu PDF" src={`${download}?inline=1`}/> :
        manifest.format === 'markdown' ? <MarkdownDocument source={markdown}/> : <pre className="library-text">{text}</pre>}
    </section>
    {share && <section className="app-panel"><LibrarySharing id={id} {...share}/>
      <RemoveLibraryItem id={id} version={item.row.version}/></section>}
  </AppShell>;
}
