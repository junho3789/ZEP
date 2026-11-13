const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({hasTouch:true,isMobile:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:390,height:700});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#527761}iframe{border:0;position:absolute}#toolbar{position:fixed;bottom:0;left:0;right:0;height:80px;background:#ffffffbb;z-index:9999;display:grid;place-items:center;font:12px sans-serif}</style><div id="toolbar">ZEP 하단 UI 모의 영역</div>');
  const root=__dirname+'/';
  const assets={};for(const file of ['stamp-ui.html','stamp-mini.html'])assets[file]=fs.readFileSync(root+file,'utf8');
  const source=fs.readFileSync(root+'main.js','utf8');
  await page.evaluate(({assets,source})=>{
    let sequence=0;window.records=[];window.events={};
    const App={};for(const name of ['onJoinPlayer','onLeavePlayer','onSay','onObjectTouched','onDestroy'])App[name]={Add:fn=>window.events[name]=fn};
    function show(file,margins,width,height){
      const frame=document.createElement('iframe');frame.dataset.file=file;frame.dataset.id=String(++sequence);
      frame.style.cssText=margins?'inset:0;width:100%;height:100%;':'top:0;left:0;width:'+width+'px;height:'+height+'px;';
      frame.style.zIndex=String(100+sequence);
      const record={file,id:sequence,dead:false,frame};window.records.push(record);
      const widget={sendMessage:data=>frame.contentWindow.postMessage(data,'*'),destroy(){record.dead=true;frame.remove();return false;},onMessage:{Add:fn=>record.receive=fn}};
      window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&record.receive)record.receive(window.player,event.data);});
      document.body.append(frame);frame.srcdoc=assets[file];return widget;
    }
    window.player={storage:'{}',save(){},sendMessage(){},openWebLink(){},showWidget:(file,align,w,h)=>show(file,false,w,h),showWidgetResponsive:(file)=>show(file,true)};
    const config=new Function('App',source+'\nreturn CONFIG;')(App);config.objects.forEach(object=>object.url='https://example.com/'+object.id);
    window.events.onJoinPlayer(window.player);
  },{assets,source});
  const full=()=>page.frameLocator('iframe[data-file="stamp-ui.html"]');
  const mini=()=>page.frameLocator('iframe[data-file="stamp-mini.html"]');
  await full().locator('body.hud-ready').waitFor();
  const miniId=await page.locator('iframe[data-file="stamp-mini.html"]').getAttribute('data-id');
  for(const[width,height]of [[390,700],[320,568],[360,640],[844,390],[568,320],[1280,800],[390,700]]){
   await page.setViewportSize({width,height});await page.waitForTimeout(100);
   const box=await full().locator('main').boundingBox();
   assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height-80,JSON.stringify({width,height,box}));
   if(width<=400&&height>=568)assert.ok(box.width>=220,'too narrow: '+JSON.stringify(box));
   assert.equal(await full().locator('.item').count(),4);
   assert.equal(await full().locator('.grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),width>=500&&height<=480?4:2);
   console.log('PASS responsive HUD:',width,height,Math.round(box.width),Math.round(box.height));
  }
  // Collecting a stamp must not recreate its image node or hide the ready card.
  await full().locator('.stamp img').first().evaluate(el=>el.dataset.kept='yes');
  await page.evaluate(()=>window.events.onObjectTouched(window.player,0,0,0,{type:21,text:201,param1:'stamp:1'}));
  await full().locator('#count').filter({hasText:'01'}).waitFor();
  assert.equal(await full().locator('.stamp img').first().getAttribute('data-kept'),'yes');
  for(let i=0;i<10;i++){
   await full().locator('#toggle').tap();
   await page.waitForFunction(()=>!document.querySelector('iframe[data-file="stamp-ui.html"]'));
   assert.equal(await page.locator('iframe[data-file="stamp-mini.html"]').getAttribute('data-id'),miniId);
   assert.equal(await mini().locator('#launcher img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
   await mini().locator('#launcher').tap();
   // Multiple pending expand messages cannot invert the state or create another panel.
   await mini().locator('#launcher').evaluate(()=>{for(let j=0;j<8;j++)window.parent.postMessage({type:'expand'},'*');});
   await full().locator('body.hud-ready').waitFor();
   assert.equal(await page.locator('iframe[data-file="stamp-ui.html"]').count(),1);
   assert.equal(await full().locator('#count').textContent(),'01');
  }
  assert.equal(await page.evaluate(()=>window.records.filter(r=>r.file==='stamp-mini.html').length),1);
  await page.screenshot({path:'/tmp/stamp-mobile-hud-v19.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS ten touch cycles, rapid expands, stable mini frame, stable image nodes, no JS errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
