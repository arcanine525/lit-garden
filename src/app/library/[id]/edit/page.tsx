import Link from 'next/link';
import { DriveError } from '../../../../server/drive/provider';
import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../../../server/auth/session';
import { ownedLibraryItem, readLibraryItem } from '../../../../server/library/items';
import { isId } from '../../../../server/student-drafts/http';
import { AppShell } from '../../../app-shell';
import { LibraryEditor } from './library-editor';
import '../../../editor/editor.css';
import '../../library.css';

export default async function LibraryEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role !== 'teacher') notFound();
  const { id } = await params;
  if (!isId(id)) notFound();
  const item = await ownedLibraryItem(user.id,id.toLowerCase()).catch(() => notFound());
  if (item.state === 'draft') return <AppShell user={user} current="/library" title="Thêm tài liệu"><LibraryEditor id={item.id} version={item.version}/></AppShell>;
  const current = await readLibraryItem(user.id,item.id).catch(error => {
    if (error instanceof DriveError && ['DRIVE_SETUP_REQUIRED','DRIVE_RECONNECT'].includes(error.code)) return null;
    throw error;
  });
  if (!current) return <AppShell user={user} current="/library" title="Sửa tài liệu">
    <section className="app-panel">
      <h2>Kết nối lại Google Drive</h2>
      <p role="alert">Cần kết nối Drive của bạn để mở tài liệu này.</p>
      <Link className="app-button app-primary" href="/drive">Kết nối Google Drive</Link>
    </section>
  </AppShell>;
  const { title,category,author,sourceLabel,excerpt,format } = current.manifest;
  return <AppShell user={user} current="/library" title="Sửa tài liệu">
    <LibraryEditor id={item.id} version={current.row.version} initial={{ title,category,author,sourceLabel,excerpt,format,markdown:current.markdown }}/>
  </AppShell>;
}
