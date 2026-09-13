const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const core = require('../extension/core.js');
const script = fs.readFileSync('extension/content.js','utf8');
const coreScript = fs.readFileSync('extension/core.js','utf8');
const bar = (value = 100) => `<progress max="100" value="${value}"></progress>`;
const quiz = (multiple = false) => `<div class="question-text">Chọn ${multiple ? 'các số chẵn' : 'kết quả 1 + 1'}?</div>${['Một','Hai','Bốn'].map((t,i)=>`<label><input type="${multiple?'checkbox':'radio'}" name="q" value="${i}">${t}</label>`).join('')}<button id="submit">Gửi đáp án</button>`;
const reviewMenu = () => `<div id="slide-label">slide: Câu hỏi ôn tập 2</div><nav class="sidebar">
  <div class="cs-listitem cs-viewed" data-ref="video" data-slide-title="Video trước đó">Video trước đó</div>
  <div class="cs-listitem cs-viewed" data-ref="review1" data-slide-title="Câu hỏi ôn tập 1">Câu hỏi ôn tập 1</div>
  <div class="cs-listitem cs-restricted cs-viewed cs-selected" data-ref="review2" data-slide-title="Câu hỏi ôn tập 2">Câu hỏi ôn tập 2<span aria-hidden="true"><span class="lockedIcon" style="display:none"></span></span></div>
</nav>`;
async function setup(html, solve = async () => ({answers:[1],reason:'Hai'}), selectors = {}, archiveRecord) {
  const dom = new JSDOM(`<style>*{opacity:1;pointer-events:auto}.acc-shadow-el{opacity:0;pointer-events:none}</style>${html}`, {url:'https://scorm.eduone.io.vn/test',runScripts:'outside-only'});
  const w = dom.window; let now = 10000, listener;
  Object.defineProperty(w.HTMLElement.prototype, 'getBoundingClientRect', {value() { return {width:100,height:20,x:0,y:0}; }});
  w.Date.now = () => now;
  w.setInterval = () => 1; w.clearInterval = () => {};
  const messages = [];
  w.chrome = {runtime:{id:'test-extension',onMessage:{addListener(fn){listener=fn;}},async sendMessage(m) {
    messages.push(m);
    if(m.type==='HELLO') return {running:false};
    if(m.type==='SOLVE') return solve(m.question);
    return {ok:true};
  }}};
  if (archiveRecord) w.SuiteCapture={context:()=>({courseTitle:'Môn học',exerciseTitle:'Ôn tập',exerciseId:'review'}),record:archiveRecord};
  w.eval(coreScript); w.eval(script);
  await Promise.resolve();
  const send = m => listener(m,{},()=>{});
  send({type:'START',run:{session:'test',config:{...core.defaults,selectors:{...core.defaults.selectors,...selectors}}}});
  await Promise.resolve();
  return {w, doc:w.document,messages,send,close:()=>dom.window.close(), async step(ms=2000){now+=ms;await w.__lessonAssistant.tick();},snapshot:()=>w.__lessonAssistant.snapshot()};
}
test('does not skip incomplete video, clicks once after full timeline',async()=>{
  const h=await setup(`<div class="slide">Video</div>${bar(50)}<button id="next">Tiếp theo</button>`);
  let clicks=0;h.doc.querySelector('#next').onclick=()=>clicks++;
  await h.step();assert.equal(clicks,0);
  h.doc.querySelector('progress').value=100;await h.step();assert.equal(clicks,0);
  await h.step();assert.equal(clicks,1);await h.step();assert.equal(clicks,1);h.close();
});

test('SCORM persists the submitted question and confirmed grade before Continue removes the result',async()=>{
  const records=[];
  const h=await setup(`<div class="slide">${quiz()}</div>`,undefined,{},async(ctx,items)=>records.push({ctx,items:JSON.parse(JSON.stringify(items))}));
  let submitted=0,continued=0;
  h.doc.querySelector('#submit').onclick=()=>{
    submitted++;assert.equal(records.at(-1).items[0].kind,'submitted');
    h.doc.querySelector('.slide').innerHTML='<p>Chúc mừng, em đã trả lời đúng!</p><button id="continue">Tiếp tục học</button>';
    h.doc.querySelector('#continue').onclick=()=>{continued++;assert.equal(records.at(-1).items[0].correct,true);};
  };
  await h.step();await h.step();await h.step();await h.step();
  assert.equal(submitted,1);assert.equal(continued,1);
  assert.deepEqual(records.map(r=>r.items[0].kind),['seen','ai','submitted','graded']);
  assert.equal(records.at(-1).items[0].question.options[1],'Hai');assert.equal(records.at(-1).ctx.attempt,'test');h.close();
});

test('SCORM archives incorrect feedback before Học lại, without calling it a correct answer',async()=>{
  const records=[];
  const h=await setup(`<div class="slide">${quiz()}</div>`,undefined,{},async(ctx,items)=>records.push(JSON.parse(JSON.stringify(items[0]))));
  h.doc.querySelector('#submit').onclick=()=>{h.doc.querySelector('.slide').innerHTML='<p>Rất tiếc, em đã trả lời sai.</p><button id="retry">Học lại</button>';};
  await h.step();await h.step();await h.step();
  const grade=records.find(r=>r.kind==='graded');assert.ok(grade);assert.equal(grade.correct,false);assert.deepEqual(grade.selected_indices,[1]);h.close();
});
test('waits until Next becomes visible and enabled',async()=>{
  const h=await setup(`<div class="slide">Video</div>${bar()}<button id="next" hidden disabled>Tiếp theo</button>`);
  let clicks=0;const n=h.doc.querySelector('#next');n.onclick=()=>clicks++;
  await h.step();assert.equal(clicks,0);n.hidden=false;await h.step();assert.equal(clicks,0);n.disabled=false;await h.step();assert.equal(clicks,1);h.close();
});
test('late question takes priority over Next and submits only once',async()=>{
  const h=await setup(`<div class="slide">Video</div>${bar()}<button id="next">Tiếp theo</button>`);
  let next=0,submit=0;h.doc.querySelector('#next').onclick=()=>next++;
  h.doc.querySelector('.slide').innerHTML=quiz();h.doc.querySelector('#submit').onclick=()=>submit++;
  await h.step();await h.step();await h.step();await h.step();
  assert.equal(next,0);assert.equal(submit,1);assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,1);h.close();
});
test('standalone review question handles initially disabled submit',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  let count=0;const b=h.doc.querySelector('#submit');b.disabled=true;b.onclick=()=>count++;
  h.doc.querySelectorAll('input').forEach(i=>i.onchange=()=>b.disabled=false);
  await h.step();await h.step();assert.equal(count,1);h.close();
});
test('multiple answers clear unwanted previously checked choices',async()=>{
  const h=await setup(`<div class="slide">${quiz(true)}</div>`,async()=>({answers:[1,2]}));
  h.doc.querySelector('input').checked=true;await h.step();await h.step();
  assert.deepEqual([...h.doc.querySelectorAll('input')].map(x=>x.checked),[false,true,true]);h.close();
});
test('correct feedback triggers Continue once, never re-submits',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  let cont=0;h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').innerHTML='<p>Chúc mừng, em đã trả lời đúng!</p><button id="continue">Tiếp tục</button>';
    h.doc.querySelector('#continue').onclick=()=>cont++;
  };
  await h.step();await h.step();await h.step();await h.step();assert.equal(cont,1);h.close();
});

for (const timed of [true, false]) test(`${timed ? 'video quiz' : 'review'} transitions to TIẾP TỤC HỌC without correct text`, async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${timed ? bar() : ''}`);
  let clicks=0;
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').outerHTML='<div class="slide"><p>Vì: phần giải thích đáp án.</p><button class="acc-shadow-el acc-button">TIẾP TỤC HỌC</button></div>';
    if(timed) h.doc.querySelector('progress').value=20;
    h.doc.querySelector('.acc-button').onclick=()=>clicks++;
  };
  await h.step();await h.step();await h.step();
  assert.equal(clicks,0);
  if(timed) {
    await h.step(35000);assert.equal(clicks,0);
    assert.equal(h.messages.some(m=>m.type==='PAUSE'),false);
    h.doc.querySelector('progress').value=100;
  }
  await h.step();await h.step();await h.step();
  assert.equal(clicks,1);assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,1);h.close();
});

test('starting on observed Storyline explanation with rounded full timeline continues exactly once', async()=>{
  const h=await setup('<div class="slide"><p>Vì: nội dung giải thích.</p><button class="acc-shadow-el acc-button">TIẾP TỤC HỌC</button></div><input type="range" data-ref="progressBar" max="31509" step="100" value="31500" aria-valuetext="100%">');
  let clicks=0;h.doc.querySelector('button').onclick=()=>clicks++;
  await h.step();await h.step();await h.step();assert.equal(clicks,1);
  assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);h.close();
});

test('explanation longer than response timeout can reveal Continue only after video ends', async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${bar()}`);
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').innerHTML='<p>Vì: xem video giải thích.</p>';
    h.doc.querySelector('progress').value=10;
  };
  await h.step();await h.step();await h.step();await h.step(40000);
  assert.equal(h.messages.some(m=>m.type==='PAUSE'),false);
  h.doc.querySelector('progress').value=100;
  h.doc.querySelector('.slide').insertAdjacentHTML('beforeend','<button>TIẾP TỤC HỌC</button>');
  let clicks=0;h.doc.querySelector('button').onclick=()=>clicks++;
  await h.step();await h.step();await h.step();assert.equal(clicks,1);h.close();
});

test('continue waits for enabled state and unknown timeline never permits leaving explanation', async()=>{
  const h=await setup('<div class="slide">Giải thích<button disabled>TIẾP TỤC HỌC</button></div><div role="progressbar"></div>');
  let clicks=0;const b=h.doc.querySelector('button');b.onclick=()=>clicks++;
  await h.step();b.disabled=false;await h.step();assert.equal(clicks,0);
  h.doc.querySelector('[role="progressbar"]').outerHTML=bar();b.disabled=true;
  await h.step();await h.step();assert.equal(clicks,0);
  b.disabled=false;await h.step();await h.step();assert.equal(clicks,1);h.close();
});

test('Continue on an explicitly wrong result acts as retry and never records success', async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  let clicks=0;
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').innerHTML='<p>Không đúng. Hãy thử lại.</p><button>TIẾP TỤC HỌC</button>';
    h.doc.querySelector('button').onclick=()=>clicks++;
  };
  await h.step();await h.step();await h.step();await h.step();assert.equal(clicks,1);
  assert.equal(h.messages.some(m=>m.type==='COMPLETE'),false);h.close();
});

test('Continue shown beside an unanswered question is not clicked', async()=>{
  let clicks=0;const h=await setup(`<div class="slide">${quiz()}<button id="continue">TIẾP TỤC HỌC</button></div>${bar(10)}`);
  h.doc.querySelector('#continue').onclick=()=>clicks++;
  await h.step();await h.step();assert.equal(clicks,0);h.close();
});

test('review result layer with quiz still behind it can continue without a recognized success phrase', async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);let clicks=0;
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').insertAdjacentHTML('beforeend','<div role="dialog"><p>Đã ghi nhận câu trả lời.</p><button>TIẾP TỤC HỌC</button></div>');
    h.doc.querySelector('[role="dialog"] button').onclick=()=>clicks++;
  };
  await h.step();await h.step();await h.step();await h.step();await h.step();assert.equal(clicks,1);h.close();
});

test('after Continue closes the layer, the next question can be answered', async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').innerHTML='<p>Bạn đã trả lời chính xác.</p><button>TIẾP TỤC HỌC</button>';
    h.doc.querySelector('button').onclick=()=>h.doc.querySelector('.slide').innerHTML=quiz().replace('1 + 1','2 + 2');
  };
  await h.step();await h.step();await h.step();await h.step();await h.step();await h.step();
  assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,2);h.close();
});
test('wrong answer + HỌC LẠI retains history through replay and asks Gemini again',async()=>{
  let calls=0,history;
  const h=await setup(`<div class="slide">${quiz()}</div>`,async q=>{history=q.history;return {answers:[calls++ ? 2 : 1]};});
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').outerHTML='<div class="slide"><p>RẤT TIẾC, EM ĐÃ TRẢ LỜI SAI.</p><button id="retry">HỌC LẠI</button></div>';
    h.doc.querySelector('#retry').onclick=()=>{h.doc.querySelector('.slide').outerHTML=`<div class="slide">Xem lại video</div>${bar(10)}`;};
  };
  await h.step();await h.step();await h.step();await h.step();assert.equal(calls,1);
  h.doc.querySelector('progress').remove();h.doc.querySelector('.slide').outerHTML=`<div class="slide">${quiz()}</div>`;
  await h.step();await h.step();assert.equal(calls,2);assert.equal(history.length,1);assert.match(history[0].feedback,/TRẢ LỜI SAI/);h.close();
});

async function reviewRetryFixture({locked=false, shuffled=false}={}) {
  const events=[],questions=[];
  const h=await setup(`${reviewMenu()}<div class="slide">${quiz()}</div>${bar()}`,async q=>{
    questions.push(JSON.parse(JSON.stringify(q)));return {answers:[questions.length===1?0:1]};
  });
  h.doc.querySelector('[data-ref="review1"]').onclick=()=>events.push('wrong-item');
  h.doc.querySelector('[data-ref="review2"]').onclick=()=>{
    events.push('review2');
    h.doc.querySelector('.slide').outerHTML=`<div class="slide">${shuffled?quiz().replace('Một','Ba'):quiz()}</div>`;
    h.doc.querySelector('#slide-label').textContent='slide: Câu hỏi ôn tập 2';
    h.doc.querySelector('[data-ref="video"]').classList.remove('cs-selected');
    h.doc.querySelector('[data-ref="review2"]').classList.add('cs-selected');
    h.doc.querySelector('progress').value=0;
  };
  h.doc.querySelector('#submit').onclick=()=>{
    events.push('submit');h.doc.querySelector('.slide').outerHTML='<div class="slide"><p>Sai</p><button id="retry">Học lại</button></div>';
    h.doc.querySelector('#retry').onclick=()=>{
      events.push('retry');h.doc.querySelector('.slide').outerHTML='<div class="slide">Video trước đó</div>';
      h.doc.querySelector('#slide-label').textContent='slide: Video trước đó';
      h.doc.querySelector('[data-ref="review2"]').classList.remove('cs-selected');
      h.doc.querySelector('[data-ref="video"]').classList.add('cs-selected');
      if(locked) h.doc.querySelector('.lockedIcon').style.display='inline-block';
      h.doc.querySelector('progress').value=5;
    };
  };
  await h.step();await h.step();await h.step();
  return {h,events,questions};
}

test('wrong review clicks Học lại then the exact review entry without waiting for the previous video',async()=>{
  const {h,events,questions}=await reviewRetryFixture();
  assert.deepEqual(events,['submit','retry']);assert.equal(h.doc.querySelector('progress').value,5);
  await h.step();assert.deepEqual(events,['submit','retry','review2']);
  await h.step();assert.equal(questions.length,1); // The short question timeline still must finish.
  h.doc.querySelector('progress').value=100;await h.step();await h.step();await h.step();
  assert.equal(questions.length,2);assert.equal(questions[1].history[0].confirmedWrong,true);
  assert.deepEqual(questions[1].history[0].answers,[1]);h.close();
});

test('locked review is not clicked and the extension stops instead of watching/skipping other videos',async()=>{
  const {h,events,questions}=await reviewRetryFixture({locked:true});
  await h.step();await h.step(16000);
  assert.deepEqual(events,['submit','retry']);assert.equal(questions.length,1);
  assert.ok(h.messages.some(m=>m.type==='PAUSE' && /khóa/.test(m.text)));h.close();
});

test('Stop clears pending return-to-review navigation',async()=>{
  const {h,events}=await reviewRetryFixture();h.send({type:'STOP'});await h.step();await h.step();
  assert.deepEqual(events,['submit','retry']);h.close();
});

test('changed options on review retry do not reuse old numbered wrong answers',async()=>{
  const {h,questions}=await reviewRetryFixture({shuffled:true});
  await h.step();await h.step();h.doc.querySelector('progress').value=100;await h.step();await h.step();
  assert.equal(questions.length,2);assert.equal(questions[1].history.length,0);h.close();
});

test('duplicate review titles are resolved by the saved data-ref, never by title alone',async()=>{
  const {h,events}=await reviewRetryFixture();
  h.doc.querySelector('.sidebar').insertAdjacentHTML('afterbegin','<div class="cs-listitem cs-viewed" data-ref="other-review2" data-slide-title="Câu hỏi ôn tập 2">Câu hỏi ôn tập 2</div>');
  h.doc.querySelector('[data-ref="other-review2"]').onclick=()=>events.push('other-review2');
  await h.step();assert.deepEqual(events,['submit','retry','review2']);h.close();
});

test('starting on a wrong review result can recover without inventing answer history',async()=>{
  const h=await setup(`${reviewMenu()}<div class="slide">Đang tải</div>${bar()}`);let retry=0,returnClicks=0;
  h.doc.querySelector('.slide').innerHTML='<p>Sai</p><button id="retry">Học lại</button>';
  h.doc.querySelector('#retry').onclick=()=>{
    retry++;h.doc.querySelector('.slide').innerHTML='Video trước đó';h.doc.querySelector('progress').value=10;
    h.doc.querySelector('#slide-label').textContent='slide: Video trước đó';h.doc.querySelector('.cs-selected').classList.remove('cs-selected');
  };
  h.doc.querySelector('[data-ref="review2"]').onclick=()=>returnClicks++;
  await h.step();await h.step();await h.step();assert.equal(retry,1);assert.equal(returnClicks,1);
  assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);h.close();
});

test('video quiz is not classified as review just because review entries exist in the sidebar',async()=>{
  const h=await setup(`${reviewMenu()}<div class="slide">${quiz()}</div>${bar()}`);let jumps=0;
  h.doc.querySelector('#slide-label').textContent='slide: Video trước đó';
  h.doc.querySelector('.cs-selected').classList.remove('cs-selected');h.doc.querySelector('[data-ref="video"]').classList.add('cs-selected');
  h.doc.querySelector('[data-ref="review2"]').onclick=()=>jumps++;
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').innerHTML='<p>Sai</p><button id="retry">Học lại</button>';
    h.doc.querySelector('#retry').onclick=()=>{h.doc.querySelector('.slide').innerHTML='Video trước đó';h.doc.querySelector('progress').value=10;};
  };
  await h.step();await h.step();await h.step();await h.step();assert.equal(jumps,0);h.close();
});
test('does not retry without explicit retry control',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  h.doc.querySelector('#submit').onclick=()=>h.doc.querySelector('.slide').insertAdjacentHTML('beforeend','<p>Sai</p>');
  await h.step();await h.step();await h.step();await h.step();assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,1);h.close();
});

test('video result from screenshot clicks HOC LAI once even when no quiz was submitted in this run',async()=>{
  const h=await setup(`<nav class="sidebar"><div class="cs-listitem cs-selected" data-ref="video" data-slide-title="1.2.3. Phong trào giải phóng dân tộc 1939 - 1945">Video</div></nav><div class="slide">Đang tải</div>${bar()}`);
  let retries=0,next=0;
  h.doc.querySelector('.slide').innerHTML='<p>RẤT TIẾC, EM ĐÃ TRẢ LỜI SAI.</p><p>EM HÃY XEM LẠI NỘI DUNG GIỚI THIỆU VỀ PHONG TRÀO GIẢI PHÓNG DÂN TỘC 1939 - 1945 ĐỂ NẮM NỘI DUNG LIÊN QUAN ĐẾN CÂU HỎI</p><button class="acc-shadow-el acc-button" id="retry">HỌC LẠI</button><button id="next">Tiếp theo</button>';
  h.doc.querySelector('#retry').onclick=()=>retries++;
  h.doc.querySelector('#next').onclick=()=>next++;
  await h.step();await h.step();await h.step();
  assert.equal(retries,1);assert.equal(next,0);assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);
  await h.step(16000);assert.equal(retries,1);assert.match(h.messages.find(m=>m.type==='PAUSE').text,/xem lại.*chưa đóng/);h.close();
});

test('untracked wrong feedback waits for a visible enabled retry button then resumes the replay',async()=>{
  const h=await setup(`<div class="slide">Đang tải</div>${bar()}`);let retries=0,next=0;
  h.doc.querySelector('.slide').innerHTML='<p>Em đã trả lời sai.</p><button id="retry" hidden disabled>Học lại</button><button id="next">Tiếp theo</button>';
  const b=h.doc.querySelector('#retry');b.onclick=()=>{
    retries++;h.doc.querySelector('.slide').innerHTML='Xem lại nội dung';h.doc.querySelector('progress').value=10;
  };
  h.doc.querySelector('#next').onclick=()=>next++;
  await h.step();assert.equal(retries,0);b.hidden=false;await h.step();assert.equal(retries,0);
  b.disabled=false;await h.step();await h.step();assert.equal(retries,1);assert.equal(next,0);
  assert.equal(h.messages.some(m=>m.type==='PAUSE'),false);h.close();
});

test('late wrong feedback after a timed transition retains the submitted answer through HOC LAI',async()=>{
  const questions=[];
  const h=await setup(`<div class="slide">${quiz()}</div>${bar()}`,async q=>{
    questions.push(structuredClone(q));return {answers:[questions.length===1?1:2]};
  });
  h.doc.querySelector('#submit').onclick=()=>{
    h.doc.querySelector('.slide').outerHTML='<div class="slide">Đang hiện màn phản hồi</div>';
    h.doc.querySelector('progress').value=10;
  };
  await h.step();await h.step();await h.step();await h.step(35000);
  assert.equal(h.messages.some(m=>m.type==='PAUSE'),false);
  h.doc.querySelector('.slide').innerHTML='<p>RẤT TIẾC, EM ĐÃ TRẢ LỜI SAI.</p><button id="retry">HỌC LẠI</button>';
  h.doc.querySelector('progress').value=100;
  let retries=0;h.doc.querySelector('#retry').onclick=()=>{
    retries++;h.doc.querySelector('.slide').outerHTML='<div class="slide">Xem lại video</div>';
    h.doc.querySelector('progress').value=10;
  };
  await h.step();assert.equal(retries,1);await h.step();
  h.doc.querySelector('.slide').innerHTML=quiz();h.doc.querySelector('progress').value=100;
  await h.step();await h.step();await h.step();
  assert.equal(questions.length,2);assert.equal(questions[1].history.length,1);
  assert.deepEqual(questions[1].history[0].answers,[2]);assert.equal(questions[1].history[0].confirmedWrong,true);h.close();
});

test('an enabled HOC LAI control without wrong feedback is not clicked',async()=>{
  const h=await setup('<div class="slide">Nội dung bài học<button>HỌC LẠI</button></div>');let clicks=0;
  h.doc.querySelector('button').onclick=()=>clicks++;
  await h.step();await h.step();assert.equal(clicks,0);h.close();
});
test('stops only after completion slide timeline ends; ignores sidebar completion label',async()=>{
  const h=await setup(`<nav>Hoàn thành bài học</nav><div class="slide">Video bình thường</div>${bar(30)}<button id="next">Tiếp theo</button>`);
  await h.step();assert.equal(h.messages.some(m=>m.type==='COMPLETE'),false);
  h.doc.querySelector('.slide').textContent='Hoàn thành bài học';await h.step();assert.equal(h.messages.some(m=>m.type==='COMPLETE'),false);
  h.doc.querySelector('progress').value=100;await h.step();await h.step();assert.equal(h.messages.filter(m=>m.type==='COMPLETE').length,1);h.close();
});
test('unknown progress and glossary slider do not count as completed timeline',async()=>{
  const h=await setup('<div class="slide">Từ điển thuật ngữ<input type="range" aria-label="Slider 2" value="4" max="4"></div><div class="seekbar"></div><button id="next">Tiếp theo</button>');
  let clicks=0;h.doc.querySelector('#next').onclick=()=>clicks++;
  await h.step();await h.step();assert.equal(clicks,0);assert.equal(h.snapshot().p.done,false);h.close();
});
test('actual Storyline transparent progress input is readable while disabled',async()=>{
  const h=await setup('<div class="slide">TỪ ĐIỂN THUẬT NGỮ</div><input style="opacity:0" data-ref="progressBar" type="range" aria-label="tiến trình slide" max="100000" value="100000" disabled><button id="next">Tiếp theo</button>');
  let n=0;h.doc.querySelector('#next').onclick=()=>n++;await h.step();assert.equal(n,1);h.close();
});
test('Storyline transparent accessibility radios and submit are usable, hidden ones excluded',async()=>{
  const h=await setup(`<div class="slide"><div class="acc-shadow-dom"><div class="acc-shadow-el acc-text">Một cộng một bằng mấy?</div><div class="acc-shadow-el"><input class="acc-shadow-el acc-radio" type="radio" name="q" aria-labelledby="a"><span id="a">Một</span></div><div class="acc-shadow-el"><input class="acc-shadow-el acc-radio" type="radio" name="q" aria-labelledby="b"><span id="b">Hai</span></div><input class="acc-shadow-el" type="radio" aria-hidden="true"><button class="acc-shadow-el" id="submit">Gửi đáp án</button></div></div>`);
  let submit=0;h.doc.querySelector('#submit').onclick=()=>submit++;await h.step();await h.step();assert.equal(submit,1);assert.equal(h.snapshot().q.options.length,2);h.close();
});
test('nested seekbar uses its child slider instead of unknown wrapper',async()=>{
  const h=await setup('<div class="slide">Video</div><div class="seekbar"><div role="slider" aria-valuenow="100" aria-valuemax="100"></div></div>');
  assert.equal(h.snapshot().p.done,true);h.close();
});
test('stopping during Gemini request prevents stale selection and submission',async()=>{
  let finish;const h=await setup(`<div class="slide">${quiz()}</div>`,()=>new Promise(r=>finish=r));
  const inFlight=h.step();await Promise.resolve();h.send({type:'STOP'});finish({answers:[1]});await inFlight;
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
test('changed question discards Gemini result',async()=>{
  let finish;const h=await setup(`<div class="slide">${quiz()}</div>`,()=>new Promise(r=>finish=r));
  const inFlight=h.step();await Promise.resolve();h.doc.querySelector('.question-text').textContent='Câu mới?';finish({answers:[1]});await inFlight;
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
test('invalid answer pauses without sending anything',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`,async()=>({answers:[999]}));await h.step();
  assert.equal(h.messages.some(m=>m.type==='PAUSE'),true);assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
test('API failure pauses instead of looping costly requests',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`,async()=>({error:'Gemini HTTP 429'}));await h.step();await h.step();
  assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,1);assert.equal(h.messages.some(m=>m.type==='PAUSE'),true);h.close();
});
test('strict answer validation rejects duplicates, empty, fractional, out of range and multiple for radio',()=>{
  for(const answers of [[],[1,1],[1.1],[0],[5],[1,2]])assert.throws(()=>core.validateAnswer({answers},4,false));
  assert.deepEqual(core.validateAnswer({answers:[2,4]},4,true),[1,3]);
  assert.equal(core.ratio(null,0,100),null);assert.equal(core.ratio(1,1,1),null);
});
test('completion words inside a question do not stop the lesson',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${bar()}`);
  h.doc.querySelector('.question-text').textContent='Cần làm gì để hoàn thành bài học?';
  await h.step();await h.step();assert.equal(h.messages.some(m=>m.type==='COMPLETE'),false);
  assert.equal(h.messages.some(m=>m.type==='SOLVE'),true);h.close();
});
test('remaining answer requires distinct, explicitly confirmed wrong single choices',()=>{
  const wrong = n => ({answers:[n],confirmedWrong:true,feedback:'Sai'});
  assert.equal(core.remainingSingleAnswer(4,false,[wrong(1),wrong(2),wrong(3)]),3);
  assert.equal(core.remainingSingleAnswer(4,false,[wrong(1),wrong(1),wrong(2)]),null);
  assert.equal(core.remainingSingleAnswer(4,false,[wrong(1),wrong(2),{answers:[3],feedback:''}]),null);
  assert.equal(core.remainingSingleAnswer(4,true,[wrong(1),wrong(2),wrong(3)]),null);
  assert.equal(core.remainingSingleAnswer(4,false,[wrong(1),wrong(2),wrong(3),wrong(4)]),null);
});
async function fourChoiceRun({multiple=false, retry=true, allWrong=false}={}) {
  let calls=0,continues=0;const submitted=[];
  const form=quiz(multiple).replace('<button id="submit">',`<label><input type="${multiple?'checkbox':'radio'}" name="q" value="3">Tám</label><button id="submit">`);
  const h=await setup(`<div class="slide">${form}</div>`,async()=>({answers:[calls++]}));
  h.doc.addEventListener('click',event=>{
    if(event.target.id==='submit') {
      submitted.push([...h.doc.querySelectorAll('input')].flatMap((x,i)=>x.checked?[i]:[]));
      h.doc.querySelector('.slide').innerHTML=submitted.length===4&&!allWrong ? '<p>Chính xác</p><button id="continue">Tiếp tục</button>' : `<p>Sai</p>${retry?'<button id="retry">Thử lại</button>':''}`;
    } else if(event.target.id==='retry') h.doc.querySelector('.slide').innerHTML=form;
    else if(event.target.id==='continue') continues++;
  });
  for(let i=0;i<24;i++) await h.step();
  return {h,calls,continues,submitted};
}
test('three different wrong answers in four-choice radio lead to last choice without fourth API call',async()=>{
  const r=await fourChoiceRun();assert.equal(r.calls,3);assert.deepEqual(r.submitted,[[0],[1],[2],[3]]);assert.equal(r.continues,1);r.h.close();
});
test('last-choice inference never bypasses the course retry button',async()=>{
  const r=await fourChoiceRun({retry:false});assert.equal(r.calls,1);assert.equal(r.submitted.length,1);r.h.close();
});
test('multi-select retains configured cap, without automatic fourth choice',async()=>{
  const r=await fourChoiceRun({multiple:true});assert.equal(r.calls,3);assert.equal(r.submitted.length,3);assert.equal(r.h.messages.some(m=>m.type==='PAUSE'),true);r.h.close();
});
test('if even the final remaining answer is rejected, stop instead of looping',async()=>{
  const r=await fourChoiceRun({allWrong:true});assert.equal(r.calls,3);assert.equal(r.submitted.length,4);assert.equal(r.h.messages.some(m=>m.type==='PAUSE'),true);r.h.close();
});
test('synchronous context invalidation is caught and stops further API requests',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  let calls=0;
  h.w.chrome.runtime.sendMessage=()=>{calls++;throw new Error('Extension context invalidated.');};
  await assert.doesNotReject(h.step());
  const stoppedAt=calls;
  await h.step();await new Promise(resolve=>setImmediate(resolve));
  assert.ok(stoppedAt>0);assert.equal(calls,stoppedAt);
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
test('halt also catches synchronous send failure for a non-context error',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>`);
  h.w.chrome.runtime.sendMessage=m=>{
    if(m.type==='SOLVE') return Promise.resolve({error:'Gemini HTTP 429'});
    if(m.type==='PAUSE') throw new Error('Extension context invalidated.');
    return Promise.resolve({ok:true});
  };
  await assert.doesNotReject(h.step());await new Promise(resolve=>setImmediate(resolve));
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
test('missing runtime after reload prevents Next even when timeline is complete',async()=>{
  const h=await setup(`<div class="slide">Video</div>${bar()}<button id="next">Tiếp theo</button>`);
  let clicks=0;h.doc.querySelector('#next').onclick=()=>clicks++;
  delete h.w.chrome.runtime.id;
  await h.step();await h.step();assert.equal(clicks,0);h.close();
});
test('context invalidation during Gemini response prevents answer clicks',async()=>{
  let finish;const h=await setup(`<div class="slide">${quiz()}</div>`,()=>new Promise(r=>finish=r));
  const inFlight=h.step();await Promise.resolve();
  delete h.w.chrome.runtime.id;finish({answers:[1]});await assert.doesNotReject(inFlight);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});
const roundedStorylineBar = (value = 28700, reported = '100%') => `<input type="range" data-ref="progressBar" aria-label="tiến trình slide" max="28757" step="100" value="${value}" aria-valuetext="${reported}" style="opacity:0">`;

test('retry identity follows answer text across reordering, retaining multi-select combinations',()=>{
  const options=['Một','Hai','Bốn'];
  assert.equal(core.historyKey('Câu hỏi?',options,false),core.historyKey('Câu hỏi?',['Bốn','Một','Hai'],false));
  assert.notEqual(core.questionKey('Câu hỏi?',options,false),core.questionKey('Câu hỏi?',['Bốn','Một','Hai'],false));
  assert.notEqual(core.historyKey('Câu hỏi?',options,false),core.historyKey('Câu hỏi?',['Ba','Hai','Bốn'],false));
  const mapped=core.remapHistory([{answers:[1,3],answerTexts:['Một','Bốn'],confirmedWrong:true,feedback:'Sai'}],['Bốn','Một','Hai']);
  assert.deepEqual(mapped[0].answers,[1,2]);assert.equal(mapped[0].confirmedWrong,true);
  assert.throws(()=>core.remapHistory(mapped,['Một','Một','Bốn']),/Không đối chiếu/);
});

for (const review of [false,true]) test(`reshuffled ${review?'review':'video'} question never resubmits the same wrong text when AI repeats it`,async()=>{
  const orders=[['Một','Hai','Bốn','Tám'],['Tám','Một','Hai','Bốn'],['Hai','Bốn','Tám','Một'],['Một','Bốn','Hai','Tám']];
  const form=order=>`<p class="acc-shadow-el acc-text">Rectangle 1</p><div class="acc-shadow-el acc-text">Chọn số theo yêu cầu của câu hỏi?</div>${order.map((t,i)=>`<div class="acc-shadow-el"><input class="acc-shadow-el" type="radio" name="q" aria-labelledby="opt${i}"><label id="opt${i}" style="display:none">${t}</label></div>`).join('')}<button id="submit">Gửi đáp án</button>`;
  const submitted=[],requests=[];let continues=0;
  const h=await setup(`${review?reviewMenu():''}<div class="slide">${form(orders[0])}</div>`,async q=>{
    requests.push(JSON.parse(JSON.stringify(q)));
    return {answers:[q.options.indexOf('Một')]};
  });
  h.doc.addEventListener('click',e=>{
    const slide=h.doc.querySelector('.slide');
    if(e.target.id==='submit'){
      const input=h.doc.querySelector('input:checked');submitted.push(h.doc.getElementById(input.getAttribute('aria-labelledby')).textContent);
      slide.innerHTML=submitted.length===4?'<p>Chính xác</p><button id="continue">Tiếp tục</button>':'<p>Sai</p><button id="retry">Thử lại</button>';
    } else if(e.target.id==='retry') slide.innerHTML=form(orders[submitted.length]);
    else if(e.target.id==='continue') {continues++;slide.innerHTML='<p>Bài giảng tiếp theo</p>';}
  });
  for(let i=0;i<28;i++)await h.step();
  assert.deepEqual(submitted,['Một','Tám','Hai','Bốn']);assert.equal(requests.length,3);assert.equal(continues,1);
  assert.equal(requests.every(q=>q.text==='Chọn số theo yêu cầu của câu hỏi?'),true);
  assert.deepEqual(requests[1].history.map(x=>x.answers),[[2]]);
  assert.deepEqual(requests[2].history.map(x=>x.answers),[[4],[3]]);
  assert.equal(h.messages.some(m=>m.type==='PAUSE'),false);h.close();
});

test('choice order changing while AI is running discards its old positional answer',async()=>{
  let finish;const h=await setup(`<div class="slide">${quiz()}</div>`,()=>new Promise(r=>finish=r));
  const running=h.step();await Promise.resolve();
  const labels=[...h.doc.querySelectorAll('label')];labels[2].before(labels[0]);
  finish({answers:[0]});await running;
  assert.equal([...h.doc.querySelectorAll('input')].some(x=>x.checked),false);h.close();
});

async function videoRetryFixture({acceptSeek=true,review=false,locked=false,startOnQuestion=false,startOnWrong=false,retryLabel='Học lại'}={}) {
  const h=await setup(`${reviewMenu()}<div class="slide"></div><input data-ref="progressBar" type="range" max="100000" value="10000" disabled><button id="next">Tiếp theo</button>`);
  const slide=h.doc.querySelector('.slide'),range=h.doc.querySelector('[data-ref="progressBar"]');
  let seeks=0,opens=0,next=0,retries=0;
  const select=ref=>{
    h.doc.querySelectorAll('.cs-listitem').forEach(el=>el.classList.toggle('cs-selected',el.dataset.ref===ref));
    h.doc.getElementById('slide-label').textContent='slide: '+h.doc.querySelector(`[data-ref="${ref}"]`).dataset.slideTitle;
  };
  const video=()=>{
    slide.innerHTML='<video></video>';range.value='10000';
    Object.defineProperty(slide.querySelector('video'),'duration',{value:100});
    slide.querySelector('video').currentTime=10;
  };
  select(review?'review2':'video');
  if(startOnWrong) {slide.innerHTML=`<p>Rất tiếc, em đã trả lời sai.</p><button id="retry">${retryLabel}</button>`;range.value='100000';}
  else if(startOnQuestion) {video();slide.insertAdjacentHTML('beforeend',quiz());range.value='100000';}
  else {video();await h.step();slide.innerHTML=quiz();range.value='100000';}
  range.addEventListener('change',()=>{seeks++;if(acceptSeek&&slide.querySelector('video'))slide.querySelector('video').currentTime=Number(range.value)/1000;});
  h.doc.addEventListener('click',e=>{
    if(e.target.id==='submit')slide.innerHTML=`<p>Sai</p><button id="retry">${retryLabel}</button>`;
    else if(e.target.id==='retry') {retries++;select('review1');video();}
    else if(e.target.dataset.ref===(review?'review2':'video')) {opens++;select(e.target.dataset.ref);if(review){slide.innerHTML=quiz();range.value='100000';}else video();}
    else if(e.target.id==='next')next++;
  });
  if(locked)h.doc.querySelector('[data-ref="video"]').setAttribute('aria-disabled','true');
  for(let i=0;i<10&&!retries;i++)await h.step();
  return {h,slide,range,select,counts:()=>({seeks,opens,next,retries})};
}

test('wrong video answer returns to exact video and seeks 98% using the player change handler',async()=>{
  const r=await videoRetryFixture();
  await r.h.step();await r.h.step();await r.h.step();
  assert.deepEqual(r.counts(),{seeks:1,opens:1,next:0,retries:1});
  assert.equal(r.range.disabled,true);assert.equal(r.range.value,'98000');
  assert.equal(r.slide.querySelector('video').currentTime,98);
  assert.equal(r.h.w.__lessonAssistant.diagnose().videoReturn,null);
  await r.h.step();assert.equal(r.counts().next,0);
  r.range.value='100000';r.slide.querySelector('video').currentTime=100;
  await r.h.step();await r.h.step();assert.equal(r.counts().next,1);r.h.close();
});

test('starting on a question with its visible video also captures the retry target',async()=>{
  const r=await videoRetryFixture({startOnQuestion:true});
  await r.h.step();await r.h.step();await r.h.step();assert.equal(r.counts().seeks,1);r.h.close();
});

for(const retryLabel of ['TIẾP TỤC HỌC','HỌC LẠI']) for(const startOnWrong of [false,true]) {
  test(`${retryLabel}: ${startOnWrong?'starting on wrong result':'submitted wrong answer'} returns through intro to saved menu video and seeks 98%`,async()=>{
    const r=await videoRetryFixture({retryLabel,startOnWrong});
    assert.equal(r.h.doc.querySelector('.cs-selected').dataset.ref,'review1');
    assert.equal(r.counts().seeks,0);
    await r.h.step();
    assert.equal(r.h.doc.querySelector('.cs-selected').dataset.ref,'video');
    assert.equal(r.counts().seeks,0);
    await r.h.step();await r.h.step();
    assert.deepEqual(r.counts(),{seeks:1,opens:1,next:0,retries:1});
    assert.equal(r.range.value,'98000');assert.equal(r.slide.querySelector('video').currentTime,98);
    assert.equal(r.h.w.__lessonAssistant.diagnose().videoReturn,null);
    if(startOnWrong)assert.equal(r.h.messages.some(m=>m.type==='SOLVE'),false);
    assert.equal(r.h.messages.some(m=>m.type==='COMPLETE'),false);r.h.close();
  });
}

test('review wrong-result Continue alias still returns directly to the review without seeking',async()=>{
  const r=await videoRetryFixture({review:true,startOnWrong:true,retryLabel:'TIẾP TỤC HỌC'});
  await r.h.step();await r.h.step();
  assert.equal(r.counts().retries,1);assert.equal(r.counts().opens,1);assert.equal(r.counts().seeks,0);
  assert.equal(r.h.doc.querySelector('.cs-selected').dataset.ref,'review2');r.h.close();
});

test('wrong-result Continue alias waits until enabled and is clicked once',async()=>{
  const h=await setup('<div class="slide"><p>Rất tiếc, em đã trả lời sai.</p><button id="continue" disabled>TIẾP TỤC HỌC</button></div>');
  let clicks=0;const button=h.doc.querySelector('#continue');button.onclick=()=>clicks++;
  await h.step();await h.step();assert.equal(clicks,0);
  button.disabled=false;await h.step();await h.step();assert.equal(clicks,1);h.close();
});

test('a slider change without actual media movement does not confirm the seek',async()=>{
  const r=await videoRetryFixture({acceptSeek:false});
  for(let i=0;i<13;i++)await r.h.step();
  assert.equal(r.counts().seeks,1);assert.equal(r.counts().next,0);
  assert.equal(r.slide.querySelector('video').currentTime,10);
  assert.equal(r.h.messages.some(m=>m.type==='PAUSE'&&/98%/.test(m.text)),true);r.h.close();
});

test('review retry reopens its question without seeking a video',async()=>{
  const r=await videoRetryFixture({review:true});
  await r.h.step();await r.h.step();assert.equal(r.counts().opens,1);assert.equal(r.counts().seeks,0);r.h.close();
});

test('locked retry video is neither clicked nor sought',async()=>{
  const r=await videoRetryFixture({locked:true});
  for(let i=0;i<13;i++)await r.h.step();
  assert.equal(r.counts().opens,0);assert.equal(r.counts().seeks,0);assert.equal(r.counts().next,0);r.h.close();
});

test('Stop cancels pending video return and seek',async()=>{
  const r=await videoRetryFixture();r.h.send({type:'STOP'});
  await r.h.step();await r.h.step();assert.equal(r.counts().opens,0);assert.equal(r.counts().seeks,0);r.h.close();
});

test('normal video playback never seeks before a confirmed wrong answer',async()=>{
  const h=await setup(`${reviewMenu()}<div class="slide"><video></video></div><input type="range" data-ref="progressBar" max="100000" value="15000" disabled>`);
  Object.defineProperty(h.doc.querySelector('video'),'duration',{value:100});
  let seeks=0;h.doc.querySelector('[data-ref="progressBar"]').onchange=()=>seeks++;
  for(let i=0;i<5;i++)await h.step();
  assert.equal(seeks,0);assert.equal(h.doc.querySelector('[data-ref="progressBar"]').value,'15000');h.close();
});

test('identical questions in different menu entries do not inherit each other’s wrong answers',async()=>{
  const requests=[];
  const h=await setup(`${reviewMenu()}<div class="slide">${quiz()}</div>`,async q=>{requests.push(JSON.parse(JSON.stringify(q)));return {answers:[requests.length===2?1:0]};});
  h.doc.addEventListener('click',e=>{
    const slide=h.doc.querySelector('.slide');
    if(e.target.id==='submit')slide.innerHTML=requests.length===1?'<p>Sai</p><button id="retry">Thử lại</button>':'<p>Chính xác</p><button id="continue">Tiếp tục</button>';
    else if(e.target.id==='retry')slide.innerHTML=quiz();
    else if(e.target.id==='continue'){
      h.doc.querySelector('.cs-selected').classList.remove('cs-selected');
      h.doc.querySelector('[data-ref="review1"]').classList.add('cs-selected');
      h.doc.getElementById('slide-label').textContent='slide: Câu hỏi ôn tập 1';
      slide.outerHTML=`<div class="slide" id="another-slide">${quiz()}</div>`;
    }
  });
  for(let i=0;i<20&&requests.length<3;i++)await h.step();
  assert.equal(requests.length,3);assert.equal(requests[1].history.length,1);assert.deepEqual(requests[2].history,[]);h.close();
});
test('observed Storyline 28700/28757 at step 100 and reported 100% is complete',()=>{
  assert.deepEqual(core.rangeProgress('28700',0,'28757','100',true),{value:1,done:true});
  assert.equal(core.rangeProgress('28600',0,'28757','100',true).done,false);
  assert.equal(core.rangeProgress('28700',0,'28757','100',false).done,false);
  assert.equal(core.rangeProgress('29900',0,'30000','100',true).done,false);
  assert.equal(core.rangeProgress('99999',0,'100000','1',false).done,false);
  assert.equal(core.rangeProgress('28700',0,'28757','any',true).done,false);
  assert.equal(core.rangeProgress(null,0,'28757','100',true).done,false);
});
test('stuck screenshot case now solves question once and submits once after settling',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${roundedStorylineBar()}`);
  let sends=0;h.doc.querySelector('#submit').onclick=()=>sends++;
  assert.equal(h.snapshot().p.done,true);assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);
  await h.step();await h.step();await h.step();
  assert.equal(h.messages.filter(m=>m.type==='SOLVE').length,1);assert.equal(sends,1);h.close();
});
test('rounded timeline advances plain video or glossary only once after settling',async()=>{
  const h=await setup(`<div class="slide">Từ điển thuật ngữ</div>${roundedStorylineBar()}<button id="next">Tiếp theo</button>`);
  let next=0;h.doc.querySelector('#next').onclick=()=>next++;
  assert.equal(next,0);await h.step();await h.step();assert.equal(next,1);h.close();
});
test('rounded timeline correctly stops final lesson slide',async()=>{
  const h=await setup(`<div class="slide">Hoàn thành bài học</div>${roundedStorylineBar()}`);
  await h.step();await h.step();assert.equal(h.messages.filter(m=>m.type==='COMPLETE').length,1);h.close();
});
test('reported 100% at an earlier step cannot skip waiting for video',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${roundedStorylineBar(28600)}`);
  await h.step();await h.step();assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);
  assert.equal(h.snapshot().p.done,false);h.close();
});
test('last reachable step without player completion signal still waits and diagnoses raw values',async()=>{
  const h=await setup(`<div class="slide">${quiz()}</div>${roundedStorylineBar(28700,'99%')}`);
  await h.step();await h.step();assert.equal(h.messages.some(m=>m.type==='SOLVE'),false);
  const d=h.w.__lessonAssistant.diagnose();
  const timeline=d.controls.find(c=>c.label==='tiến trình slide');
  assert.equal(timeline.now,'28700');assert.equal(timeline.max,'28757');assert.equal(timeline.step,'100');
  assert.equal(timeline.valueText,'99%');h.close();
});
