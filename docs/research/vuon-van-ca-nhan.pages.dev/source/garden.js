const Garden = (() => {
  const groups = [
    {key:'sprout',name:'Mầm',label:'bài đang viết',empty:'Em đã nộp tất cả bài được giao.'},
    {key:'flower',name:'Hoa',label:'bài chờ góp ý',empty:'Hiện chưa có bài đang chờ góp ý.'},
    {key:'fruit',name:'Quả',label:'bài đã nhận xét',empty:'Những bài được trả nhận xét sẽ xuất hiện ở đây.'}
  ];
  function classify(assignments, submissions, studentId) {
    const latest = new Map();
    for (const submission of submissions) {
      if(submission.studentId !== studentId) continue;
      const previous = latest.get(submission.assignmentId);
      const newer = !previous || (Number.isFinite(submission.version) && Number.isFinite(previous.version)
        ? submission.version > previous.version
        : String(submission.createdAt || '').localeCompare(String(previous.createdAt || '')) > 0 ||
          submission.createdAt === previous.createdAt && String(submission.id).localeCompare(String(previous.id)) > 0);
      if(newer) latest.set(submission.assignmentId, submission);
    }
    return assignments.map(assignment => {
      const submission = latest.get(assignment.id);
      return {assignment,submission,stage:!submission?'sprout':submission.status==='returned'?'fruit':'flower'};
    });
  }
  function mount(host, records, onSelect) {
    host.innerHTML='<section class="garden-cards" aria-label="Khu vườn bài viết">'+groups.map(group=>{
      const count=records.filter(record=>record.stage===group.key).length;
      return '<button type="button" class="garden-stage '+group.key+'" data-stage="'+group.key+'" aria-pressed="false" aria-label="'+group.name+': '+count+' '+group.label+'"><img class="garden-card-art" src="garden-'+group.key+'.webp" alt=""><span class="garden-card-caption"><span class="garden-stage-name">'+group.name+'</span><span class="garden-stage-summary"><span class="garden-stage-count">'+count+'</span> <span class="garden-stage-label">'+group.label+'</span></span><span class="garden-card-arrow" aria-hidden="true">↗</span></span></button>';
    }).join('')+'</section>';
    function select(key) {
      const group=groups.find(group=>group.key===key);
      host.querySelectorAll('[data-stage]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.stage===key)));
      onSelect(group?records.filter(record=>record.stage===key):records,group);
    }
    host.querySelectorAll('[data-stage]').forEach(button=>button.onclick=()=>select(button.dataset.stage));
    return {reset:()=>select(null)};
  }
  return {classify,mount};
})();
