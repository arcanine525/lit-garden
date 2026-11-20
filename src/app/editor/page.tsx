import { notFound, redirect } from 'next/navigation';
import { sessionUser } from '../../server/auth/session';
import { uuidPattern } from '../../server/auth/identity-operations';
import { database } from '../../server/db';
import { AppShell } from '../app-shell';
import { EditorWorkbench } from './editor-workbench';
import './editor.css';

export default async function EditorPage({ searchParams }: { searchParams: Promise<{ assignment?: string }> }) {
  const user = await sessionUser();
  if (!user) redirect('/');
  if (user.role === 'admin') notFound();
  const { assignment } = await searchParams;
  if (assignment !== undefined) {
    if (user.role !== 'teacher' || typeof assignment !== 'string' || !uuidPattern.test(assignment)) notFound();
    const result = await database().query(`SELECT a.id FROM garden.assignments a JOIN garden.classes c ON c.id=a.class_id
      WHERE a.id=$1 AND a.teacher_id=$2 AND a.state='draft' AND c.state='active'`,[assignment,user.id]);
    if (!result.rowCount) notFound();
  }
  return <AppShell user={user} current="/editor" title="Soạn Markdown">
    <section className="app-panel">
      <p>Tải tệp Markdown để giữ nội dung đang soạn.</p>
      <EditorWorkbench role={user.role} assignmentId={assignment} validate/>
    </section>
  </AppShell>;
}
