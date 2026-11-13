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
  const assets={};for(const file of ['stamp-ui.html','stamp-mini.html','photo-booth.html'])assets[file]=fs.readFileSync(root+file,'utf8');
  const source=fs.readFileSync(root+'main.js','utf8');
  await page.evaluate(({assets,source})=>{
    let sequence=0;window.records=[];window.events={};window.flashes=[];
    const App={runLater:(fn,seconds)=>setTimeout(fn,seconds*1000)};for(const name of ['onJoinPlayer','onLeavePlayer','onSay','onObjectTouched','onDestroy'])App[name]={Add:fn=>window.events[name]=fn};
    function show(file,margins,width,height,align){
      const frame=document.createElement('iframe');frame.dataset.file=file;frame.dataset.id=String(++sequence);
      frame.style.cssText=margins?'inset:0;width:100%;height:100%;':'top:0;left:0;width:'+width+'px;height:'+height+'px;';
      if(!margins&&align==='middleleft'){frame.style.top='50%';frame.style.transform='translateY(-50%)';}
      frame.style.zIndex=String(100+sequence);
      const record={file,id:sequence,dead:false,frame};window.records.push(record);
      const widget={sendMessage:data=>frame.contentWindow.postMessage(data,'*'),destroy(){record.dead=true;frame.remove();return false;},onMessage:{Add:fn=>record.receive=fn}};
      window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&record.receive)record.receive(window.player,event.data);});
      if(file==='photo-booth.html')frame.addEventListener('load',()=>{
        new MutationObserver(()=>{
          if(frame.contentDocument.body.classList.contains('flashing')) frame.contentWindow.setTimeout(()=>{
            if(frame.isConnected)window.flashes.push(Number(frame.contentWindow.getComputedStyle(frame.contentDocument.getElementById('flash')).opacity));
          },65);
        }).observe(frame.contentDocument.body,{attributes:true,attributeFilter:['class']});
      });
      document.body.append(frame);frame.srcdoc=assets[file];return widget;
    }
    window.player={storage:'{}',save(){},sendMessage(){},openWebLink(){},showWidget:(file,align,w,h)=>show(file,false,w,h,align),showWidgetResponsive:(file)=>show(file,true)};
    const config=new Function('App',source+'\nreturn CONFIG;')(App);config.objects.forEach(object=>object.url='https://example.com/'+object.id);
    window.events.onJoinPlayer(window.player);
  },{assets,source});
  // PC native controls occupy discrete buttons, not a full-width click-blocking bar.
  await page.evaluate(()=>document.querySelector('body > div').style.pointerEvents='none');
  const photo=()=>page.frameLocator('iframe[data-file="photo-booth.html"]');
  const hit=()=>page.evaluate(()=>window.events.onObjectTouched(window.player,0,0,0,{type:21,text:'206',param1:'photo:booth'}));
  const frames=page.locator('iframe[data-file="photo-booth.html"]');
  await page.frameLocator('iframe[data-file="stamp-ui.html"]').locator('body.hud-ready').waitFor();
  const original=await page.evaluate(()=>window.player.storage);
  await hit();await hit();assert.equal(await frames.count(),1);
  await photo().locator('#number').filter({hasText:'3'}).waitFor();
  await photo().locator('body').evaluate(()=>{
    window.sequence=[{value:'3',at:performance.now()}];
    new MutationObserver(()=>window.sequence.push({value:document.getElementById('number').textContent,at:performance.now()})).observe(document.getElementById('number'),{childList:true});
    window.parent.postMessage({type:'photo_ready'},'*');
  });
  await page.screenshot({path:'/tmp/photo-booth-desktop-v1.10.png'});
  await photo().locator('#number').filter({hasText:'2'}).waitFor();
  await photo().locator('#number').filter({hasText:'1'}).waitFor();
  const sequence=await photo().locator('body').evaluate(()=>window.sequence);
  assert.deepEqual(sequence.map(s=>s.value),['3','2','1']);
  assert.ok(sequence[1].at-sequence[0].at>750);assert.ok(sequence[2].at-sequence[1].at>750);
  await page.waitForFunction(()=>window.flashes.length>0,{},{polling:10});
  await frames.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.player.storage),original);
  await page.mouse.click(800,400);await page.keyboard.press('ArrowRight');
  await hit();await photo().locator('body.started').waitFor();await page.keyboard.press('Escape');await frames.waitFor({state:'detached'});
  await page.setViewportSize({width:390,height:700});
  await hit();await photo().locator('#number').filter({hasText:'3'}).waitFor();
  const stage=await photo().locator('.stage').boundingBox(),button=await photo().locator('#close').boundingBox();
  assert.ok(stage.x>=0&&stage.x+stage.width<=390);assert.ok(button.y>=80&&button.y+button.height<620);
  await page.screenshot({path:'/tmp/photo-booth-mobile-v1.10.png'});
  await photo().locator('#close').click();await frames.waitFor({state:'detached'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>window.flashes=[]);
  await hit();await page.waitForFunction(()=>window.flashes.length>0,{},{polling:10});
  assert.equal(await page.evaluate(()=>window.flashes[0]),.22);
  await frames.waitFor({state:'detached'});
  await hit();await photo().locator('body.started').waitFor();
  await photo().locator('body').evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
  await frames.waitFor({state:'detached'});
  const mobile=await browser.newPage({hasTouch:true,isMobile:true,viewport:{width:390,height:700}});
  await mobile.setContent(assets['photo-booth.html']);
  await mobile.evaluate(()=>window.postMessage({type:'photo_start',stepMs:1000,flashMs:160},'*'));
  await mobile.locator('body.started').waitFor();
  await mobile.locator('#close').tap();
  await mobile.locator('body.finished').waitFor();
  assert.equal(await mobile.locator('#flash').evaluate(el=>getComputedStyle(el).opacity),'0');
  await mobile.close();
  assert.deepEqual(errors,[]);
  console.log('PASS 3-2-1 timing, single flash, automatic cleanup, duplicate prevention, Escape/button, mobile bounds, reduced motion and background cancellation');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
