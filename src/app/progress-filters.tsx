'use client';

import { useRouter } from 'next/navigation';
import { useOptimistic, useTransition } from 'react';

type ClassOption = { id: string; name: string; teacherId: string; teacherName: string };

export function ProgressFilters({ path, classes, classId, teacherId }: {
  path: string; classes: ClassOption[]; classId?: string; teacherId?: string;
}) {
  const router = useRouter();
  const [pending,startTransition] = useTransition();
  const [filters, setFilters] = useOptimistic({ teacherId, classId });
  const teachers = Array.from(new Map(classes.map(room => [room.teacherId,room.teacherName])));
  const visibleClasses = classes.filter(room => !filters.teacherId || room.teacherId === filters.teacherId);
  function apply(teacher: string, selectedClass: string) {
    const room = classes.find(room => room.id === selectedClass && (!teacher || room.teacherId === teacher));
    const query = new URLSearchParams();
    if (teacher) query.set('teacher',teacher);
    if (room) query.set('class',room.id);
    startTransition(() => {
      setFilters({ teacherId:teacher || undefined,classId:room?.id });
      router.push(query.size ? path + '?' + query.toString() : path,{ scroll:false });
    });
  }
  return <div className="progress-filters" role="group" aria-label="Lọc bài viết" aria-busy={pending}>
    <label>Giáo viên<select name="teacher" value={filters.teacherId ?? ''} onChange={event => apply(event.target.value,filters.classId ?? '')}>
      <option value="">Tất cả giáo viên</option>
      {teachers.map(([id,name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label>Lớp<select name="class" value={filters.classId ?? ''} onChange={event => apply(filters.teacherId ?? '',event.target.value)}>
      <option value="">Tất cả các lớp</option>
      {visibleClasses.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
    </select></label>
    {pending && <span className="visually-hidden" role="status">Đang cập nhật bài viết…</span>}
  </div>;
}
