// Shared writing and reviewing tools for both editions.
const Writing = (() => {
  const colors = {yellow:'Vàng', green:'Xanh lá', pink:'Hồng', blue:'Xanh lam'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const words = text => (text.match(/\S+/gu) || []).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
  const countLabel = text => words(text).toLocaleString('vi-VN') + ' từ';
  const countHint = 'Đếm theo khoảng trắng, bỏ qua dấu câu đứng riêng. Ví dụ “học sinh” tính là 2.';
  function scan(text) {
    const rules = [
      [/(?<![\p{L}\p{M}])chình\s+tả(?![\p{L}\p{M}])/giu,'Kiểm tra cách viết “chính tả”.'],
      [/(?<![\p{L}\p{M}])(?:xử dụng|suy nghỉ|giành giụm|bỗ xung)(?![\p{L}\p{M}])/giu,'Kiểm tra chính tả.'],
      [/(?<![\p{L}\p{M}])([\p{L}\p{M}]+)[ \t]+\1(?![\p{L}\p{M}])/giu,'Từ lặp liền nhau. Có thể là từ láy hoặc phép điệp có chủ ý.'],
      [/[ \t]+(?=[,;:!?])/gu,'Có khoảng trắng trước dấu câu.'],
      [/(\S)[ \t]{2,}(?=\S)/gu,'Có nhiều khoảng trắng giữa hai từ.']
    ];
    const fixes={'xử dụng':'sử dụng','suy nghỉ':'suy nghĩ','giành giụm':'dành dụm','bỗ xung':'bổ sung'};
    const result=[];
    for(const [pattern,message] of rules) for(const m of text.matchAll(pattern)){
      const start=m.index+(m[1] && message.startsWith('Có nhiều') ? m[1].length : 0);
      const end=m.index+m[0].length;
      const fix=fixes[m[0].toLocaleLowerCase('vi')];
      result.push({start,end,quote:text.slice(start,end),text:fix?'Kiểm tra cách viết “'+fix+'”.':message});
    }
    return result.sort((a,b)=>a.start-b.start);
  }
  function anchored(text,c){
    if(Number.isInteger(c.start)&&text.slice(c.start,c.end)===c.quote)return c;
    if(!c.quote)return null;
    const start=text.indexOf(c.quote);
    return start>=0&&text.indexOf(c.quote,start+1)<0?{...c,start,end:start+c.quote.length}:null;
  }
  function marked(text,comments,formats=[]) {
    const styles=(Array.isArray(formats)?formats:[]).filter(f=>Number.isInteger(f.start)&&Number.isInteger(f.end)&&f.start>=0&&f.end<=text.length&&f.end>f.start);
    const ranges=comments.map(c=>anchored(text,c)).filter(Boolean);
    const stops=[...new Set([0,text.length,...ranges.flatMap(c=>[c.start,c.end]),...styles.flatMap(f=>[f.start,f.end])])].sort((a,b)=>a-b);
    return stops.slice(1).map((end,i)=>{
      const start=stops[i];
      let content=escape(text.slice(start,end));
      for(const f of styles.filter(f=>f.start<=start&&f.end>=end)){
        if(f.bold)content='<strong>'+content+'</strong>';
        if(f.italic)content='<em>'+content+'</em>';
        if(f.underline)content='<u>'+content+'</u>';
        if(['#283f36','#295da8','#8a315a','#397045','#8b4d20'].includes(f.color))content='<span style="color:'+f.color+'">'+content+'</span>';
      }
      const notes=ranges.filter(c=>c.start<=start&&c.end>=end);
      if(!notes.length)return content;
      const last=notes.at(-1);
      return '<mark class="ink-'+(Object.hasOwn(colors,last.color)?last.color:'yellow')+'" title="'+escape(notes.map(n=>n.text).filter(Boolean).join(' · '))+'">'+content+'</mark>';
    }).join('');
  }
  function mountReview(essay,box,text,notes,changed,formats=[]) {
    box.innerHTML='<div class="review-tools"><label>Màu đánh dấu<select class="ink-color">'+Object.entries(colors).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label><button class="btn secondary" data-act="paint">Tô màu</button><button class="btn secondary" data-act="note">Bình luận</button><button class="btn secondary" data-act="scan">Rà lỗi cơ bản</button></div><small class="review-status" role="status">Chọn một đoạn trong bài để tô màu hoặc bình luận.</small><div class="note-editor" hidden><blockquote></blockquote><label>Bình luận<textarea maxlength="3000"></textarea></label><button class="btn" data-act="save">Lưu bình luận</button> <button class="link" data-act="cancel">Hủy</button></div><div class="review-notes"></div><div class="review-check"></div>';
    let selection=null,editing=null;
    const find=q=>box.querySelector(q),status=t=>find('.review-status').textContent=t;
    const draw=()=>{
      essay.innerHTML=marked(text,notes,formats);
      find('.review-notes').innerHTML=notes.map((n,i)=>'<div class="comment"><blockquote class="ink-'+(Object.hasOwn(colors,n.color)?n.color:'yellow')+'">'+escape(n.quote)+'</blockquote><p>'+escape(n.text)+'</p>'+(n.reply?'<p>Học sinh: '+escape(n.reply)+'</p>':'')+'<button class="link" data-edit="'+i+'">Sửa ghi chú</button> · <button class="link" data-remove="'+i+'">Xóa đánh dấu</button></div>').join('');
    };
    function capture(){
      const sel=window.getSelection();
      if(!sel?.rangeCount||sel.isCollapsed)return;
      const range=sel.getRangeAt(0);
      if(!essay.contains(range.commonAncestorContainer))return;
      const prefix=document.createRange();prefix.selectNodeContents(essay);prefix.setEnd(range.startContainer,range.startOffset);
      const start=prefix.toString().length,quote=range.toString();
      if(quote.trim())selection={start,end:start+quote.length,quote};
    }
    essay.addEventListener('pointerup',capture);essay.addEventListener('keyup',capture);
    box.addEventListener('pointerdown',capture);
    function editor(note,index=null){
      editing={note:{...note},index};find('.note-editor').hidden=false;
      find('.note-editor blockquote').textContent=note.quote;find('textarea').value=note.text||'';
      find('textarea').focus();
    }
    function save(note,index){
      if(index===null&&notes.length>=50)return status('Mỗi bản nộp hỗ trợ tối đa 50 đánh dấu.');
      if(index===null)notes.push({...note,id:crypto.randomUUID()});else notes[index]=note;
      selection=null;editing=null;find('.note-editor').hidden=true;changed();draw();status('Đã ghi đánh dấu.');
    }
    box.onclick=e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.hasAttribute('data-remove')){notes.splice(Number(b.dataset.remove),1);editing=null;find('.note-editor').hidden=true;changed();draw();return;}
      if(b.hasAttribute('data-edit')){const i=Number(b.dataset.edit);find('select').value=notes[i].color||'yellow';editor(notes[i],i);return;}
      const act=b.dataset.act;
      if(act==='cancel'){editing=null;find('.note-editor').hidden=true;return;}
      if(act==='save'&&editing){const value=find('textarea').value.trim();if(!value)return status('Hãy nhập bình luận.');save({...editing.note,color:find('select').value,text:value},editing.index);return;}
      if(act==='scan'){
        const issues=scan(text);
        find('.review-check').innerHTML='<h3>Rà lỗi cơ bản</h3><p>Gợi ý theo quy tắc, không tự trừ điểm.</p>'+(issues.length?issues.map((n,i)=>'<div class="comment"><q>'+escape(n.quote.trim()||'Khoảng trắng')+'</q> '+escape(n.text)+' <button class="link" data-issue="'+i+'">Ghi vào bài</button></div>').join(''):'<p>Chưa thấy dấu hiệu nào theo các quy tắc đang dùng.</p>');
        find('.review-check').querySelectorAll('[data-issue]').forEach(x=>x.onclick=()=>editor({...issues[Number(x.dataset.issue)],color:find('select').value}));return;
      }
      if(!['paint','note'].includes(act))return;
      capture();if(!selection)return status('Hãy chọn đoạn cần đánh dấu trong bài làm.');
      if(selection.quote.length>2000)return status('Chọn đoạn ngắn hơn, tối đa 2.000 kí tự.');
      const note={...selection,text:'',color:find('select').value};
      if(act==='note')editor(note);else save(note,null);
    };
    draw();
  }
  let stopTimer=()=>{};
  function timer(box,key,storage=localStorage){
    stopTimer();const storageKey='vv-clock:'+key;
    let state={elapsed:0,since:null,goal:30,open:false};
    try{Object.assign(state,JSON.parse(storage.getItem(storageKey)||'{}'));}catch{}
    const persist=()=>{try{storage.setItem(storageKey,JSON.stringify(state));}catch{}};
    const elapsed=()=>state.elapsed+(state.since===null?0:Math.max(0,Date.now()-state.since));
    const stages=['Mầm','Chồi','Nụ','Hoa'];
    const plants=[
      '<path d="M25 41q0-10-6-14"/><path fill="#9ecf74" d="M20 31Q9 31 9 22q10-2 11 9Z"/>',
      '<path d="M25 41V20"/><path fill="#82bd76" d="M25 32Q11 31 10 20q12 0 15 12Zm0-7Q26 13 39 13q-1 11-14 12Z"/>',
      '<path d="M25 41V18m0 15q9-1 12-8-9-1-12 8"/><path fill="#f19d9e" d="M25 23q-12-10 0-20 12 10 0 20Z"/>',
      '<path d="M25 41V17m0 16q9-1 12-8-9-1-12 8"/><g fill="#f6a0a5">'+[0,72,144,216,288].map(a=>'<ellipse cx="25" cy="8" rx="5" ry="7" transform="rotate('+a+' 25 16)"/>').join('')+'</g><circle cx="25" cy="16" r="5" fill="#ffd574"/>'
    ];
    box.innerHTML='<button class="btn clock-toggle" type="button"></button><div class="clock-panel" hidden><span class="plant"></span><div><strong class="clock-time"></strong> · <span class="stage"></span><label>Mốc nở hoa (phút)<input type="number" min="1" max="240" step="1"></label><button type="button" class="btn secondary clock-start"></button> <button type="button" class="link clock-reset">Đặt lại</button></div></div>';
    const el=q=>box.querySelector(q);
    function tick(){
      const ms=elapsed(),seconds=Math.floor(ms/1000),idx=Math.min(3,Math.floor(3*ms/(state.goal*60000)));
      el('.clock-time').textContent=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(v=>String(v).padStart(2,'0')).join(':');
      el('.stage').textContent=stages[idx];
      if(el('.plant').dataset.stage!==String(idx)){el('.plant').dataset.stage=idx;el('.plant').innerHTML='<svg aria-hidden="true" viewBox="0 0 50 52" width="54" height="56" fill="none" stroke="#446c4d" stroke-width="1.5">'+plants[idx]+'<path fill="#dca17c" d="M14 39h23l-4 12H18Z"/></svg>';}
    }
    function draw(){el('.clock-panel').hidden=!state.open;el('.clock-toggle').textContent=state.open?'◷ Ẩn đồng hồ làm bài':'◷ Bật đồng hồ làm bài';el('.clock-toggle').setAttribute('aria-expanded',String(state.open));el('input').value=state.goal;el('.clock-start').textContent=state.since!==null?'Tạm dừng':state.elapsed?'Tiếp tục':'Bắt đầu';tick();persist();}
    el('.clock-toggle').onclick=()=>{state.open=!state.open;if(state.open&&!state.elapsed&&state.since===null)state.since=Date.now();draw();};
    el('.clock-start').onclick=()=>{if(state.since===null)state.since=Date.now();else{state.elapsed=elapsed();state.since=null;}draw();};
    el('.clock-reset').onclick=()=>{state.elapsed=0;state.since=null;draw();};
    el('input').onchange=e=>{state.goal=Math.max(1,Math.min(240,Math.round(Number(e.target.value)||30)));draw();};
    draw();const interval=setInterval(()=>{if(!box.isConnected){clearInterval(interval);return;}if(state.open&&state.since!==null)tick();},500);stopTimer=()=>clearInterval(interval);
    return ()=>{state.elapsed=elapsed();state.since=null;draw();};
  }
  return {words,countLabel,countHint,marked,scan,mountReview,timer};
})();
