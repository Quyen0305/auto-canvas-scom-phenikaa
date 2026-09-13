const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const {JSDOM}=require('jsdom');
function setup(existing={}) {
  const data=existing;
  const chrome={storage:{local:{async get(key){return structuredClone(key==null?data:{[key]:data[key]});},async set(value){Object.assign(data,structuredClone(value));}}}};
  const ctx=vm.createContext({chrome,crypto:webcrypto,TextEncoder,TextDecoder,URL,console});
  for(const file of ['question-bank.js','xlsx-export.js','bank-export.js'])vm.runInContext(fs.readFileSync('extension/'+file,'utf8'),ctx);
  return {bank:ctx.QuestionBank,exporter:ctx.BankExport,writer:ctx.SuiteXlsx,data};
}
const sender=(quiz=2,course=1)=>({id:'suite',url:`https://canvas.test/courses/${course}/quizzes/${quiz}/take?token=SECRET`,tab:{id:3},documentId:'doc-1'});
const q={questionText:'Chọn thành phố ở Việt Nam?',options:['Hà Nội','Paris','Huế'],questionType:'multiple_answers_question'};
const record=(h,question=q,extra={},context={})=>h.bank.record(sender(),{context:{courseTitle:'Tiếng Việt',exerciseTitle:'Bài 1',attempt:'1',...context},items:[{question,...extra}]});
test('deduplicates reordered options across attempts while preserving the correct option numbers and history',async()=>{
  const h=setup();
  await record(h,q,{kind:'graded',selected_indices:[0,1],correct:false});
  await record(h,{...q,questionText:'Chọn  thành phố ở Việt Nam?',options:['Huế','Hà Nội','Paris']},{kind:'graded',selected_indices:[0,1],correct:true},{attempt:'2'});
  const {entries}=await h.bank.list();assert.equal(entries.length,1);assert.equal(entries[0].events.length,2);
  assert.equal(h.bank.result(entries[0]).verified,true);
  const sheets=h.exporter.sheets(entries);assert.equal(sheets[0].rows[2][7],'1,3');
  assert.equal(sheets.length,1);assert.equal(entries[0].events[1].options[0],'Huế');
  assert.ok(!JSON.stringify(h.data).includes('SECRET'));
});
test('course and exercise scopes isolate identical question text; permanent data survives worker restart',async()=>{
  const h=setup();
  for(const s of [sender(),sender(3),sender(2,9)])await h.bank.record(s,{items:[{question:q,kind:'graded',selected_indices:[0,2],correct:true}]});
  const restarted=setup(h.data);assert.equal((await restarted.bank.list()).entries.length,3);
  const output=restarted.exporter.build((await restarted.bank.list()).entries);assert.equal(output.groups,3);
});
test('concurrent writes do not lose attempts and repeated page scans do not duplicate observations',async()=>{
  const h=setup();await Promise.all(Array.from({length:25},(_,i)=>record(h,q,{kind:'selected',selected_indices:[0]},{attempt:String(i)})));
  await record(h,q,{kind:'selected',selected_indices:[0]},{attempt:'1'});
  assert.equal((await h.bank.list()).entries[0].events.length,25);
});
test('AI guesses, partial-credit selections, conflicts and ambiguous text never become a verified key',async()=>{
  const h=setup();await record(h,q,{kind:'ai',selected_indices:[0,2],correct:true,reason:'AI only'});
  let entry=(await h.bank.list()).entries[0];assert.equal(h.bank.result(entry).verified,false);assert.equal(h.exporter.sheets([entry])[0].rows.length,2);
  await record(h,q,{kind:'graded',selected_indices:[0,2],correct:true});
  await record(h,q,{kind:'graded',selected_indices:[0,2],correct:false},{attempt:'2'});
  entry=(await h.bank.list()).entries[0];assert.match(h.bank.result(entry).status,/mâu thuẫn/);assert.equal(h.exporter.sheets([entry])[0].rows.length,2);
  const duplicates={questionText:'Trùng lựa chọn',options:['A','A']};
  await record(h,duplicates,{kind:'graded',selected_indices:[1],correct:true});
  assert.equal(h.bank.result((await h.bank.list()).entries.find(e=>e.question.text==='Trùng lựa chọn')).verified,false);
});
test('Canvas adapter archives graded results, carries verified old learning forward, and retains unanswered questions',async()=>{
  const h=setup();
  await h.bank.captureCanvas({action:'GET_CACHED_ANSWERS',data:{questions:[{...q,id:'q'}]}},sender(),{success:true,data:{answers:[null]}});
  await h.bank.captureCanvas({action:'RECORD_QUIZ_RESULTS',data:{observations:[{question:q,selected_indices:[0,2],earned:0.5,possible:1}]}},sender(),{success:true});
  let entry=(await h.bank.list()).entries[0];assert.equal(h.bank.result(entry).verified,false);
  await h.bank.captureCanvas({action:'GET_CACHED_ANSWERS',data:{questions:[{...q,id:'q'}]}},sender(),{success:true,data:{answers:[{id:'q',selected_indices:[0],verified:true}]}});
  entry=(await h.bank.list()).entries[0];assert.equal(h.bank.result(entry).verified,true);
  assert.equal(entry.events.length,3);
});
test('SCORM iframe context belongs to top-level lesson, omits tokens, and stays separate for each review',async()=>{
  const h=setup(),s={url:'about:blank',tab:{id:4,url:'https://scorm.eduone.io.vn/en/learn/lesson1?l=PRIVATE'}};
  for(const id of ['review-1','review-2'])await h.bank.record(s,{context:{exerciseId:id,exerciseTitle:'Ôn tập'},items:[{question:q}]});
  const {entries}=await h.bank.list();assert.equal(entries.length,2);assert.ok(entries.every(e=>e.courseId.endsWith('/lesson1')));
  assert.ok(!JSON.stringify(entries).includes('PRIVATE'));
});
test('unsupported option counts keep complete content on a separate sheet',async()=>{
  const h=setup();await record(h,{questionText:'Câu có sáu lựa chọn',options:['A','B','C','D','E','F']},{kind:'graded',selected_indices:[5],correct:true});
  const sheets=h.exporter.sheets((await h.bank.list()).entries);
  assert.equal(sheets[0].rows.length,2);assert.equal(sheets[1].rows[1][7],'F');assert.equal(sheets[1].rows[1][8],'6');
});

test('export includes only confirmed keys across attempts, omits wrong history and rejects an entirely unverified bank',async()=>{
  const h=setup();
  await record(h,q,{kind:'graded',selected_indices:[1],correct:false,reason:'WRONG_ATTEMPT_NOTE'},{attempt:'1'});
  await record(h,q,{kind:'ai',selected_indices:[1],reason:'AI_GUESS_NOTE'},{attempt:'2'});
  let entries=(await h.bank.list()).entries;
  assert.throws(()=>h.exporter.build(entries),/Chưa có câu nào/);
  await record(h,{...q,options:['Huế','Paris','Hà Nội']},{kind:'graded',selected_indices:[0,2],correct:true,reason:'PRIVATE_GRADE_NOTE'},{attempt:'3'});
  await h.bank.record(sender(99),{items:[{question:{text:'UNVERIFIED_QUESTION',options:['A','B']},kind:'ai',selected_indices:[0]}]});
  await record(h,{text:'WRONG_ONLY_QUESTION',options:['X','Y']},{kind:'graded',selected_indices:[0],correct:false});
  entries=(await h.bank.list()).entries;
  const before=JSON.stringify(entries),output=h.exporter.build(entries),bytes=Buffer.from(output.bytes).toString('utf8');
  assert.equal(output.questions,1);assert.equal(output.groups,1);assert.equal(output.skipped,2);
  for(const text of ['WRONG_ATTEMPT_NOTE','AI_GUESS_NOTE','PRIVATE_GRADE_NOTE','UNVERIFIED_QUESTION','WRONG_ONLY_QUESTION','name="Lịch sử"'])assert.ok(!bytes.includes(text),text);
  assert.equal(h.exporter.sheets(entries)[0].rows[2][7],'1,3');
  assert.equal(h.exporter.sheets(entries)[0].rows[2][3],'Paris'); // Retain distractors in the original question.
  assert.equal(JSON.stringify(entries),before);assert.equal((await h.bank.list()).entries[0].events.length,3);
});
test('Canvas DOM collector reads manual selections, nested options and graded evidence without clicking',async()=>{
  const dom=new JSDOM(`<title>Quiz</title><div id="breadcrumbs"><a href="/courses/1">Môn Toán</a></div><h1 id="quiz_title">Bài 3</h1><div id="questions" class="assessment_results"><div class="display_question question multiple_answers_question"><div class="question_text">1 + 1 = ?</div><div class="user_points">0,5 / 1</div><div class="answers"><div class="answer correct_answer"><div class="answer_row"><input type="checkbox" checked><span class="answer_label">2</span></div></div><div class="answer"><input type="checkbox" checked><span class="answer_label">3</span></div></div></div></div>`,{url:'https://canvas.test/courses/1/quizzes/2/history?version=3',runScripts:'outside-only'});
  const w=dom.window;w.chrome={runtime:{sendMessage:async()=>({success:true,data:{}})}};w.setTimeout=()=>1;
  w.eval(fs.readFileSync('extension/archive-content.js','utf8'));
  const ctx=w.SuiteCapture.context();assert.equal(ctx.courseTitle,'Môn Toán');assert.equal(ctx.exerciseTitle,'Bài 3');assert.equal(ctx.attempt,'3');
  const items=w.SuiteCapture.readCanvas(w.document);assert.equal(items.length,2);assert.equal(items[0].question.options.length,2);assert.equal(items[0].correct,false);assert.equal(items[1].correct,true);assert.deepEqual([...items[1].selected_indices],[0]);
  assert.equal(w.document.querySelectorAll('input:checked').length,2);dom.window.close();
});

test('a hidden Canvas answer key still permits archiving a disabled selection graded 0.6 out of 0.6',async()=>{
  const h=setup();
  const dom=new JSDOM(`<div>Câu trả lời đúng được ẩn.</div><div id="questions" class="assessment_results"><div class="display_question question"><div class="question_text">Câu đã chấm</div><div class="user_points">0.6 / 0.6 điểm</div><div class="answers"><div class="answer"><input type="radio" disabled><span class="answer_label">A</span></div><div class="answer"><input type="radio" disabled checked><span class="answer_label">B</span></div></div></div></div>`,{url:'https://canvas.test/courses/1/quizzes/2',runScripts:'outside-only'});
  const w=dom.window;w.chrome={runtime:{sendMessage:async()=>({success:true})}};w.setTimeout=()=>1;
  w.eval(fs.readFileSync('extension/archive-content.js','utf8'));
  const items=w.SuiteCapture.readCanvas(w.document);
  assert.equal(items.length,1);assert.equal(items[0].correct,true);assert.deepEqual([...items[0].selected_indices],[1]);
  await h.bank.record(sender(),{items});
  const entries=(await h.bank.list()).entries;assert.equal(h.bank.result(entries[0]).verified,true);
  assert.equal(h.exporter.sheets(entries)[0].rows[2][7],'2');dom.window.close();
});
test('ZIP and XLSX are real nested packages; all question cells are literal text',async()=>{
  const h=setup();await record(h,{questionText:'=HYPERLINK("https://evil.test","x") < & >',options:['+1','@2']},{kind:'graded',selected_indices:[0],correct:true});
  const output=h.exporter.build((await h.bank.list()).entries);
  const unzip=bytes=>{
    const buf=Buffer.from(bytes),files={};let at=0;
    while(buf.readUInt32LE(at)===0x04034b50){const size=buf.readUInt32LE(at+18),n=buf.readUInt16LE(at+26),extra=buf.readUInt16LE(at+28),start=at+30+n+extra;files[buf.toString('utf8',at+30,at+30+n)]=buf.subarray(start,start+size);at=start+size;}return files;
  };
  const outer=unzip(output.bytes),name=Object.keys(outer).find(n=>n.endsWith('.xlsx'));assert.ok(name.includes('Tiếng Việt/'));
  const inner=unzip(outer[name]),xml=inner['xl/worksheets/sheet1.xml'].toString();
  assert.ok(xml.includes('t="inlineStr"'));assert.ok(!xml.includes('<f>'));assert.ok(xml.includes('=HYPERLINK(&quot;'));
  assert.equal(Object.keys(inner).filter(n=>/worksheets\//.test(n)).length,1);
  if(process.env.ARCHIVE_TEST_OUTPUT){fs.mkdirSync(process.env.ARCHIVE_TEST_OUTPUT,{recursive:true});fs.writeFileSync(process.env.ARCHIVE_TEST_OUTPUT+'/sample.xlsx',outer[name]);}
});

test('export flush follows only same-quiz read-only history links and waits for old grades to be archived',async()=>{
  const h=setup(),body=(earned,links='')=>`<h1 id="quiz_title">Bài 2</h1><div id="questions" class="assessment_results"><div class="display_question question"><div class="question_text">Một cộng một?</div><div class="user_points">${earned} / 1</div><div class="answers"><div class="answer"><input type="radio" checked><span class="answer_label">Hai</span></div><div class="answer"><input type="radio"><span class="answer_label">Ba</span></div></div></div></div>${links}`;
  const base='https://canvas.test/courses/1/quizzes/2/history';
  const dom=new JSDOM(body(0,`<a href="${base}?version=1">Lượt 1</a><a href="https://other.test/courses/1/quizzes/2/history">External</a><a href="/courses/1/quizzes/2/submit">Submit</a><a href="/courses/1/quizzes/3/history?version=2">Other quiz</a>`),{url:base+'?version=2',runScripts:'outside-only'});
  const w=dom.window,calls=[];let listener;
  w.setTimeout=()=>1;
  w.fetch=async url=>{calls.push(url);return {ok:true,url,text:async()=>body(1,`<a href="${base}?version=1">Same</a>`)}};
  w.chrome={runtime:{id:'suite',onMessage:{addListener:fn=>listener=fn},sendMessage:async m=>{
    if(m.action==='BANK_RECORD')return {success:true,data:await h.bank.record(sender(),m.data)};
    return {success:true};
  }}};
  w.eval(fs.readFileSync('extension/archive-content.js','utf8'));
  const reply=await new Promise(resolve=>listener({action:'BANK_FLUSH'},{id:'suite'},resolve));
  assert.equal(reply.success,true);assert.deepEqual(calls,[base+'?version=1']);
  const entry=(await h.bank.list()).entries[0];assert.equal(entry.events.length,2);assert.deepEqual(entry.events.map(e=>e.attempt).sort(),['1','2']);
  assert.match(h.bank.result(entry).status,/mâu thuẫn/);dom.window.close();
});
