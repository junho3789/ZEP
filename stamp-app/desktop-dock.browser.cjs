const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({hasTouch:false,isMobile:false});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width:1280,height:800});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#527761}iframe{border:0;position:absolute}#toolbar{position:fixed;bottom:0;left:0;right:0;height:80px;background:#ffffffbb;z-index:9999;display:grid;place-items:center;font:12px sans-serif}</style><div style="position:fixed;top:0;left:0;right:0;height:80px;background:#ffffff77;z-index:9999;display:grid;place-items:center">ZEP 상단 UI 모의 영역</div><div id="toolbar">ZEP 하단 UI 모의 영역</div>');
  const root=__dirname+'/';
  const assets={};for(const file of ['stamp-ui.html','stamp-mini.html'])assets[file]=fs.readFileSync(root+file,'utf8');
  const source=fs.readFileSync(root+'main.js','utf8');
  await page.evaluate(({assets,source})=>{
    let sequence=0;window.records=[];window.events={};
    const App={};for(const name of ['onJoinPlayer','onLeavePlayer','onSay','onObjectTouched','onDestroy'])App[name]={Add:fn=>window.events[name]=fn};
    function show(file,margins,width,height,align){
      const frame=document.createElement('iframe');frame.dataset.file=file;frame.dataset.id=String(++sequence);
      frame.style.cssText=margins?'inset:0;width:100%;height:100%;':'top:0;left:0;width:'+width+'px;height:'+height+'px;';
      if(!margins&&align==='middleleft'){frame.style.top='50%';frame.style.transform='translateY(-50%)';}
      frame.style.zIndex=String(100+sequence);
      const record={file,id:sequence,dead:false,frame};window.records.push(record);
      const widget={sendMessage:data=>frame.contentWindow.postMessage(data,'*'),destroy(){record.dead=true;frame.remove();return false;},onMessage:{Add:fn=>record.receive=fn}};
      window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&record.receive)record.receive(window.player,event.data);});
      document.body.append(frame);frame.srcdoc=assets[file];return widget;
    }
    window.player={storage:'{}',save(){},sendMessage(){},openWebLink(){},showWidget:(file,align,w,h)=>show(file,false,w,h,align),showWidgetResponsive:(file)=>show(file,true)};
    const config=new Function('App',source+'\nreturn CONFIG;')(App);config.objects.forEach(object=>object.url='https://example.com/'+object.id);
    window.events.onJoinPlayer(window.player);
  },{assets,source});
  // PC native controls occupy discrete buttons, not a full-width click-blocking bar.
  await page.evaluate(()=>document.querySelector('body > div').style.pointerEvents='none');
  const full=()=>page.frameLocator('iframe[data-file="stamp-ui.html"]');
  const mini=()=>page.frameLocator('iframe[data-file="stamp-mini.html"]');
  await full().locator('body.hud-ready.desktop-dock').waitFor();
  await mini().locator('#launcher').waitFor({state:'hidden'});
  const panel=await page.locator('iframe[data-file="stamp-ui.html"]').boundingBox();
  assert.equal(panel.x,0);assert.equal(panel.y,0);assert.equal(panel.width,368);assert.equal(panel.height,620);
  assert.equal(await full().locator('header').isVisible(),true);
  const card=await full().locator('main').boundingBox();assert.ok(card.y<=10);
  await page.evaluate(()=>{window.mapClicks=0;document.body.addEventListener('click',()=>window.mapClicks++);window.moves=0;document.addEventListener('keydown',e=>{if(e.key==='ArrowRight')window.moves++;});});
  await page.mouse.click(800,400);
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>window.mapClicks),1);
  assert.equal(await page.evaluate(()=>window.moves),1);
  assert.equal(await page.locator('iframe[data-file="stamp-ui.html"]').count(),1);
  await full().locator('.hud-layout').click({position:{x:365,y:5}});
  assert.equal(await page.locator('iframe[data-file="stamp-ui.html"]').count(),1);
  await full().locator('.name').first().click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>window.moves),2);
  await page.screenshot({path:'/tmp/stamp-desktop-v1.9.3.png'});
  await full().locator('#toggle').click();
  await mini().locator('#launcher').waitFor({state:'visible'});
  const icon=await page.locator('iframe[data-file="stamp-mini.html"]').boundingBox();assert.equal(icon.x,0);assert.equal(icon.y,0);
  await page.evaluate(()=>document.querySelector('body > div').style.pointerEvents='none');
  await mini().locator('#launcher').click();
  await full().locator('body.hud-ready.desktop-dock').waitFor();
  await full().locator('#toggle').focus();
  await page.keyboard.press('Escape');
  await mini().locator('#launcher').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
  console.log('PASS desktop bounded widget, map clicks and arrow movement, background stays open, button and Escape collapse');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
