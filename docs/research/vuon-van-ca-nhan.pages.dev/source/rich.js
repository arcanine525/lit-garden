// Store plain text plus formatting ranges. Submitted text remains immutable.
const Rich = (() => {
  const palette = {'#283f36':'Màu mặc định','#295da8':'Xanh lam','#8a315a':'Hồng tím','#397045':'Xanh lá','#8b4d20':'Nâu'};
  function mount(textarea, initial=[]) {
    const toolbar=document.createElement('div');
    toolbar.className='rich-toolbar';
    toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Định dạng văn bản');
    toolbar.innerHTML='<button type="button" data-command="bold" title="In đậm (Ctrl+B)" aria-label="In đậm"><b>B</b></button><button type="button" data-command="italic" title="In nghiêng (Ctrl+I)" aria-label="In nghiêng"><i>I</i></button><button type="button" data-command="underline" title="Gạch chân (Ctrl+U)" aria-label="Gạch chân"><u>U</u></button><span class="toolbar-divider" aria-hidden="true"></span><label class="text-color-control" title="Màu chữ"><span class="text-color-icon" aria-hidden="true">A</span><span class="color-chevron" aria-hidden="true">⌄</span><select aria-label="Màu chữ">'+Object.entries(palette).map(([v,k])=>'<option value="'+v+'">'+k+'</option>').join('')+'</select></label><button type="button" data-command="removeFormat" title="Xóa định dạng" aria-label="Xóa định dạng"><span class="clear-format-icon" aria-hidden="true">T<sub>×</sub></span></button>';
    const editor=document.createElement('div');
    editor.className='essay-editor rich-editor';editor.contentEditable='true';
    editor.setAttribute('role','textbox');editor.setAttribute('aria-label','Trang viết có định dạng');editor.setAttribute('aria-multiline','true');
    editor.innerHTML=Writing.marked(textarea.value,[],initial);
    textarea.hidden=true;textarea.required=false;
    textarea.after(editor);editor.before(toolbar);
    let selection=null;
    function remember(){
      const current=window.getSelection();
      if(current?.rangeCount && editor.contains(current.getRangeAt(0).commonAncestorContainer))selection=current.getRangeAt(0).cloneRange();
    }
    function restore(){
      editor.focus();if(selection){const current=window.getSelection();current.removeAllRanges();current.addRange(selection);}
    }
    function snapshot(){
      let text='',formats=[];
      function walk(node,style={}){
        if(node.nodeType===3){
          const start=text.length;text+=node.nodeValue;
          if(text.length>start&&Object.keys(style).length)formats.push({start,end:text.length,...style});
          return;
        }
        if(node.nodeType!==1)return;
        if(node.tagName==='BR'){text+='\n';return;}
        const block=['DIV','P','LI'].includes(node.tagName)&&node!==editor;
        if(block&&text&&!text.endsWith('\n'))text+='\n';
        const next={...style};
        if(['B','STRONG'].includes(node.tagName)||['bold','700'].includes(node.style.fontWeight))next.bold=true;
        if(['I','EM'].includes(node.tagName)||node.style.fontStyle==='italic')next.italic=true;
        if(node.tagName==='U'||node.style.textDecoration.includes('underline'))next.underline=true;
        const value=node.getAttribute('color')||node.style.color;
        if(value){
          const canvas=document.createElement('canvas').getContext('2d');
          canvas.fillStyle=value;
          if(Object.hasOwn(palette,canvas.fillStyle))next.color=canvas.fillStyle;
        }
        for(const child of node.childNodes)walk(child,next);
        if(block&&!text.endsWith('\n'))text+='\n';
      }
      walk(editor);
      // A browser-created trailing block newline is excluded from the submitted text.
      if(text.endsWith('\n'))text=text.slice(0,-1);
      formats=formats.map(f=>({...f,end:Math.min(f.end,text.length)})).filter(f=>f.start<f.end);
      return {text,formats};
    }
    function sync(){textarea.value=snapshot().text;textarea.dispatchEvent(new Event('input',{bubbles:true}));}
    editor.addEventListener('input',()=>{remember();sync();});
    editor.addEventListener('keyup',remember);editor.addEventListener('pointerup',remember);
    editor.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));sync();});
    editor.addEventListener('drop',e=>e.preventDefault());
    toolbar.onpointerdown=e=>{remember();if(e.target.closest('button'))e.preventDefault();};
    toolbar.onclick=e=>{
      const button=e.target.closest('[data-command]');if(!button)return;
      restore();document.execCommand(button.dataset.command,false,null);remember();sync();
    };
    toolbar.querySelector('select').onchange=e=>{toolbar.querySelector('.text-color-icon').style.borderColor=e.target.value;restore();document.execCommand('foreColor',false,e.target.value);remember();sync();};
    return {snapshot};
  }
  return {mount};
})();
