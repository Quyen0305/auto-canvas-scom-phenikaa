// Provider credentials last only for the current browser session.
globalThis.SuiteSettings = (() => {
  let queue=Promise.resolve(),credential;
  const session=chrome.storage?.session,SESSION_KEY='suite:sessionCredential';
  const storage=globalThis.SuiteStorage || chrome.storage;
  function serial(work){const result=queue.then(work);queue=result.catch(()=>{});return result;}
  async function readCredential(){
    if(credential!==undefined)return credential;
    try{credential=(await session?.get(SESSION_KEY))?.[SESSION_KEY] || null;}catch{credential=null;}
    // Retain a manually entered 2.3.1 key only in session RAM during migration.
    if(credential?.key)credential={engine:credential.engine,model:credential.model,providers:{gemini_api:{key:credential.key}}};
    return credential;
  }
  async function writeCredential(entry){credential=entry;try{await session?.set({[SESSION_KEY]:entry});}catch{/* Missing/restricted session API: worker RAM only. */}}
  async function credentials(ai){
    const entry=await readCredential(),profile=entry?.providers?.[SuiteCloud.credentialId(ai.engine)] || {};
    return {...ai,apiKey:profile.key || '',accountId:profile.accountId || '',searchKey:entry?.searchKey || '',baseURL:ai.engine==='ninerouter_api' && ai.model==='adaptive'?(globalThis.ADAPTIVE_BACKEND_URL || profile.baseURL || ''):(profile.baseURL || ''),searchModel:profile.searchModel || '',routerModel:profile.model || ''};
  }
  async function update(patch={}){
    const data=await storage.local.get(['suite:ai','config']),entry=await readCredential();
    const source=data['suite:ai'] || {engine:entry?.engine || 'gemini_api',model:entry?.model || 'gemini-3.8-flash'};
    const ai={engine:patch.engine ?? source.engine,model:patch.model ?? source.model};
    if(!SuiteCloud.valid(ai))throw Error('Mô hình AI không hợp lệ.');
    const next={...(entry || {}),...ai,providers:{...entry?.providers}};
    const id=SuiteCloud.credentialId(ai.engine),profile={...next.providers[id]};
    let changedGateway=false;const oldKey=profile.key;
    if(ai.engine==='ninerouter_api' && patch.baseURL?.trim() && profile.baseURL){
      try{changedGateway=SuiteCloud.gatewayBase(patch.baseURL.trim())!==SuiteCloud.gatewayBase(profile.baseURL);}catch{changedGateway=true;}
    }
    if(ai.engine==='ninerouter_api'){
      if(ai.model==='adaptive' && profile.model && profile.model!=='adaptive'){
        delete profile.key;delete profile.baseURL;delete profile.searchModel;
      }
      if(!ai.model && profile.model)ai.model=profile.model;
      if(ai.model)profile.model=ai.model;
    }
    for(const field of ['apiKey','searchKey','accountId','baseURL','searchModel']){
      if(typeof patch[field]!=='string'||!patch[field].trim())continue;
      const entered=patch[field].trim();if(/\s/.test(entered))throw Error((({accountId:'Account ID',baseURL:'Địa chỉ 9Router',searchModel:'Model tìm kiếm'})[field] || 'API key')+' chứa khoảng trắng. Hãy kiểm tra lại.');
      if(field==='searchKey')next.searchKey=entered;else profile[field==='apiKey'?'key':field]=entered;
    }
    if(changedGateway && (!patch.apiKey?.trim() || patch.apiKey.trim()===oldKey))delete profile.key;
    next.model=ai.model;next.providers[id]=profile;await writeCredential(next);
    await storage.local.set({'suite:ai':ai,config:{...data.config,provider:SuiteCloud.provider(ai.engine),model:ai.model,backgroundPlayback:true},
      'canvas:aiEngine':ai.engine,'canvas:aiModel':ai.model,'canvas:autoClickAnswer':true,'canvas:autoNextQuestion':true,'canvas:answerReviewVersion':2});
    const stored=await credentials(ai);
    return {...ai,keySaved:!!stored.apiKey,searchKeySaved:!!stored.searchKey,accountId:stored.accountId,baseURL:stored.baseURL,searchModel:stored.searchModel,routerModel:stored.routerModel};
  }
  return {ensure:()=>serial(()=>update()),save:patch=>serial(()=>update(patch)),
    credentialsFor:ai=>serial(()=>credentials(ai)),keyForTab:(_id,ai)=>serial(async()=>{const selected=ai || (await storage.local.get('suite:ai'))['suite:ai'] || await update();return (await credentials(selected)).apiKey;})};
})();
