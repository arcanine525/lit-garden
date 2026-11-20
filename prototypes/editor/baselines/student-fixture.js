export const studentAssignments = [
  { title: 'Mùa xuân trong vườn', className: '10A1', teacher: 'Cô An', open: true, outcome: null },
  { title: 'Một tiếng chim', className: '10A1', teacher: 'Cô An', open: true, outcome: 'submitted' },
  { title: 'Đường về nhà', className: '10B1', teacher: 'Cô Mai', open: true, outcome: 'returned' },
  { title: 'Giọt mưa đầu mùa', className: '10B1', teacher: 'Cô Mai', open: false, outcome: null }
];

export function progressOf({ outcome, open }) {
  if (outcome === 'returned') return 'fruit';
  if (outcome === 'submitted') return 'flower';
  return open ? 'sprout' : 'closed';
}
