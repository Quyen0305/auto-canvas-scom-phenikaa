const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
test('compact Canvas controls invoke the original buttons and preserve stop; untrusted senders cannot trigger them',()=>{
  const dom=new JSDOM('<div id="canvas-ai-solver-widget"><div class="canvas-ai-title">Canvas</div><button id="canvas-ai-solve-current">Giải câu này</button><button id="canvas-ai-auto-all">Tự động làm</button><button id="canvas-ai-target">Làm đến 10 điểm</button><small class="canvas-ai-target-help">Help</small><button id="canvas-ai-stop">Dừng</button><div id="canvas-ai-status-msg">Ready</div></div>',{runScripts:'outside-only'});
  const w=dom.window;let listener;const clicks=[];
  w.chrome={runtime:{id:'suite',onMessage:{addListener:fn=>listener=fn}}};
  w.eval(fs.readFileSync('extension/canvas-compat.js','utf8'));w.eval(fs.readFileSync('extension/canvas-controls.js','utf8'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.getElementById('canvas-ai-solve-current').hidden,true);
  assert.equal(w.document.getElementById('canvas-ai-target').hidden,false);
  for(const [command,id] of [['auto','auto-all'],['target','target'],['stop','stop']]){
    w.document.getElementById('canvas-ai-'+id).onclick=()=>clicks.push(command);
    listener({action:'SUITE_CANVAS_CONTROL',command},{id:'untrusted'},()=>{});
    listener({action:'SUITE_CANVAS_CONTROL',command},{id:'suite'},()=>{});
  }
  assert.deepEqual(clicks,['auto','target','stop']);w.close();
});
