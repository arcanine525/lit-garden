import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../../../server/auth/session';
import { ownedLibraryItem } from '../../../../server/library/items';
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
  if (item.state !== 'draft') redirect(`/library/${item.id}`);
  return <AppShell user={user} current="/library" title="Thêm tài liệu"><LibraryEditor id={item.id} version={item.version}/></AppShell>;
}
