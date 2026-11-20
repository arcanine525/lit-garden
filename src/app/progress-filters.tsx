'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type FormEvent } from 'react';

type ClassOption = { id: string; name: string; teacherId: string; teacherName: string };

export function ProgressFilters({ path, classes, classId, teacherId }: {
  path: string; classes: ClassOption[]; classId?: string; teacherId?: string;
}) {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  const teachers = Array.from(new Map(classes.map(room => [room.teacherId,room.teacherName])));
  const visibleClasses = classes.filter(room => !teacherId || room.teacherId === teacherId);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teacher = String(form.get('teacher') ?? '');
    const room = classes.find(room => room.id === form.get('class'));
    const query = new URLSearchParams();
    if (teacher) query.set('teacher',teacher);
    if (room && (!teacher || room.teacherId === teacher)) query.set('class',room.id);
    startTransition(() => router.push(query.size ? path + '?' + query.toString() : path,{ scroll:false }));
  }
  return <form className="progress-filters" action={path} method="get" onSubmit={apply} aria-label="Lọc bài viết" aria-busy={pending}>
    <label>Giáo viên<select key={teacherId ?? ''} name="teacher" defaultValue={teacherId ?? ''}>
      <option value="">Tất cả giáo viên</option>
      {teachers.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label>Lớp<select key={classId ?? ''} name="class" defaultValue={classId ?? ''}>
      <option value="">Tất cả các lớp</option>
      {visibleClasses.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
    </select></label>
    <button disabled={pending} type="submit">{pending ? 'Đang lọc…' : 'Áp dụng'}</button>
  </form>;
}
