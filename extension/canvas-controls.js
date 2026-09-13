(() => {
  CanvasCompat.compactWidget();
  if(globalThis.__suiteCanvasControls)return;
  globalThis.__suiteCanvasControls=true;
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(message.action!=='SUITE_CANVAS_CONTROL')return;
    if(sender.id!==chrome.runtime.id)return;
    const widget=document.getElementById('canvas-ai-solver-widget');
    const ids={auto:'canvas-ai-auto-all',target:'canvas-ai-target',stop:'canvas-ai-stop'};
    if(!widget){reply({error:'Chưa thấy câu hỏi Canvas. Hãy tải lại trang quiz.'});return;}
    if(message.command!=='status'){
      const button=widget.querySelector('#'+ids[message.command]);
      if(!button || button.disabled){reply({error:'Thao tác chưa sẵn sàng trên trang Canvas.'});return;}
      button.click();
    }
    reply({text:widget.querySelector('#canvas-ai-status-msg')?.textContent || 'Sẵn sàng.'});
  });
})();
