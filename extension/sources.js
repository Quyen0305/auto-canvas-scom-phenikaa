// Source links live in the current document only; provider HTML is sandboxed.
if (!globalThis.SuiteSources) globalThis.SuiteSources = (() => {
  function append(parent,result={}) {
    const box=document.createElement('div');box.className='suite-web-sources';
    if(result.warning){const warning=document.createElement('p');warning.textContent=result.warning;box.append(warning);}
    for(const source of result.sources || []) {
      let url;try{url=new URL(source.url);}catch{continue;}
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)continue;
      const line=document.createElement('p'),link=document.createElement('a');
      link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.title || url.hostname;
      line.append(link);box.append(line);
    }
    if(result.searchSuggestions) {
      const frame=document.createElement('iframe');frame.title='Google Search · Gợi ý tìm kiếm';
      frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');frame.srcdoc=String(result.searchSuggestions).slice(0,20000);
      frame.style.cssText='width:100%;height:130px;border:0;background:white';box.append(frame);
    }
    if(box.childNodes.length){const label=document.createElement('strong');label.textContent='Nguồn tham khảo';box.prepend(label);parent.append(box);}
  }
  function clear(){document.getElementById('suite-ai-sources')?.remove();}
  function show(result){
    clear();if(!result.sources?.length&&!result.searchSuggestions&&!result.warning)return;
    const panel=document.createElement('aside');panel.id='suite-ai-sources';panel.setAttribute('aria-label','Nguồn tham khảo AI');
    panel.style.cssText='position:fixed;bottom:12px;left:12px;z-index:2147483646;max-height:260px;overflow:auto;width:300px;padding:12px;background:white;color:#203a40;border:1px solid #d3dfd9;border-radius:9px;font:12px/1.5 sans-serif;box-shadow:0 2px 12px #0002';
    const close=document.createElement('button');close.textContent='Đóng nguồn';close.addEventListener('click',clear);panel.append(close);
    append(panel,result);document.body.append(panel);
  }
  return {append,show,clear};
})();
