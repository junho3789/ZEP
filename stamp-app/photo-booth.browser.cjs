const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const page=await browser.newPage({hasTouch:false,isMobile:false});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://zep-widget.test/',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Mock ZEP host</title>'}));
  await page.goto('https://zep-widget.test/');
  await page.setViewportSize({width:1280,height:800});
  await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#527761}iframe{border:0;position:absolute}#toolbar{position:fixed;bottom:0;left:0;right:0;height:80px;background:#ffffffbb;z-index:9999;display:grid;place-items:center;font:12px sans-serif}</style><div style="position:fixed;top:0;left:0;right:0;height:80px;background:#ffffff77;z-index:9999;display:grid;place-items:center">ZEP 상단 UI 모의 영역</div><div id="toolbar">ZEP 하단 UI 모의 영역</div>');
  const root=__dirname+'/';
  const assets={};for(const file of ['stamp-ui.html','stamp-mini.html','photo-booth.html'])assets[file]=fs.readFileSync(root+file,'utf8');
  const source=fs.readFileSync(root+'main.js','utf8');
  const fixture=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=48;c.height=64;const x=c.getContext('2d');
    x.fillStyle='#151515';x.fillRect(11,8,26,23);x.fillRect(13,31,22,22);
    x.fillStyle='#ffcc99';x.fillRect(13,13,22,17);x.fillStyle='#151515';x.fillRect(18,19,2,3);x.fillRect(28,19,2,3);
    x.fillStyle='#0878ff';x.fillRect(11,8,26,7);x.fillRect(15,3,18,8);x.fillRect(15,32,18,20);
    x.fillStyle='#ffffff';x.fillRect(19,32,10,13);x.fillStyle='#ff00ff';x.fillRect(15,53,7,10);x.fillRect(26,53,7,10);
    const sheet=document.createElement('canvas');sheet.width=240;sheet.height=256;const sc=sheet.getContext('2d');
    for(let i=0;i<20;i++)sc.drawImage(c,(i%5)*48,Math.floor(i/5)*64);
    const large=document.createElement('canvas');large.width=96;large.height=128;const lc=large.getContext('2d');lc.imageSmoothingEnabled=false;lc.drawImage(c,0,0,96,128);
    return {single:large.toDataURL().split(',')[1],sheet:sheet.toDataURL().split(',')[1]};
  });
  const requests=[];
  await page.route('https://cdn-static.zep.us/static/assets/baked-avartar-images/**',route=>{
    requests.push(route.request().url());
    if(route.request().url().endsWith('no-cors.png'))return route.fulfill({status:200,contentType:'image/png',body:Buffer.from(fixture.single,'base64'),headers:{'access-control-allow-origin':'https://other-origin.test'}});
    if(route.request().url().endsWith('failed.png'))return route.fulfill({status:404,body:'missing',headers:{'access-control-allow-origin':'*'}});
    return route.fulfill({status:200,contentType:'image/png',body:Buffer.from(route.request().url().endsWith('sheet.png')?fixture.sheet:fixture.single,'base64'),headers:{'access-control-allow-origin':'*'}});
  });
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
          if(frame.isConnected && frame.contentDocument && frame.contentDocument.body && frame.contentDocument.body.classList.contains('flashing')) frame.contentWindow.setTimeout(()=>{
            if(frame.isConnected)window.flashes.push(Number(frame.contentWindow.getComputedStyle(frame.contentDocument.getElementById('flash')).opacity));
          },65);
        }).observe(frame.contentDocument.body,{attributes:true,attributeFilter:['class']});
      });
      document.body.append(frame);frame.srcdoc=assets[file];return widget;
    }
    window.player={storage:'{}',name:'관람객 SONG',avatarFileName:'demo.png',save(){},sendMessage(){},openWebLink(){},showWidget:(file,align,w,h)=>show(file,false,w,h,align),showWidgetResponsive:(file)=>show(file,true)};
    const config=new Function('App',source+'\nreturn CONFIG;')(App);window.config=config;config.objects.forEach(object=>object.url='https://example.com/'+object.id);
    window.events.onJoinPlayer(window.player);
  },{assets,source});
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
  });
  await photo().locator('#number').filter({hasText:'2'}).waitFor();
  await photo().locator('#number').filter({hasText:'1'}).waitFor();
  const seq=await photo().locator('body').evaluate(()=>window.sequence);
  assert.deepEqual(seq.map(s=>s.value),['3','2','1']);assert.ok(seq[1].at-seq[0].at>750);assert.ok(seq[2].at-seq[1].at>750);
  await photo().locator('#result').waitFor();
  assert.ok(await page.evaluate(()=>window.flashes.length===1));
  const preview=await photo().locator('#card').evaluate(img=>({w:img.naturalWidth,h:img.naturalHeight}));assert.deepEqual(preview,{w:832,h:1088});
  await page.screenshot({path:'/tmp/avatar-polaroid-desktop-v1.11.2.png'});
  const downloadPromise=page.waitForEvent('download');await photo().locator('#save').click();const download=await downloadPromise;
  assert.match(download.suggestedFilename(),/^NEW-TURN-[0-9]{14}\.png$/);await download.saveAs('/tmp/avatar-polaroid-v1.11.2.png');
  const png=fs.readFileSync('/tmp/avatar-polaroid-v1.11.2.png');assert.equal(png.readUInt32BE(16),832);assert.equal(png.readUInt32BE(20),1088);
  const colors=await photo().locator('#card').evaluate(img=>{const c=document.createElement('canvas');c.width=900;c.height=1160;const x=c.getContext('2d');x.drawImage(img,0,0);const p=x.getImageData(32,32,768,760).data;let legs=0,skin=0;for(let i=0;i<p.length;i+=4){if(p[i]===255&&p[i+1]===0&&p[i+2]===255)legs++;if(p[i]===255&&p[i+1]===204&&p[i+2]===153)skin++;}return{legs,skin};});
  assert.ok(colors.legs>1000);assert.ok(colors.skin>1000);
  const framing=await photo().locator('#card').evaluate(img=>{
    const c=document.createElement('canvas');c.width=900;c.height=1160;const x=c.getContext('2d');x.drawImage(img,28,28);const p=x.getImageData(0,0,900,1160).data;
    const isBlack=(a,b)=>{let i=(b*900+a)*4;return p[i]===21&&p[i+1]===21&&p[i+2]===21;};
    let top=1160,bottom=0,torso=0;
    for(let y=150;y<800;y++)for(let xx=100;xx<790;xx++){
      if(isBlack(xx,y)){top=Math.min(top,y);bottom=Math.max(bottom,y);}
      let i=(y*900+xx)*4;if(y>500&&p[i]===255&&p[i+1]===255&&p[i+2]===255)torso++;
    }
    let ruled=0;for(let y=150;y<800;y++)if(isBlack(65,y)&&isBlack(100,y))ruled++;
    return {top,bottom,torso,ruled};
  });
  const background=await photo().locator('#card').evaluate(img=>{
    const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const x=c.getContext('2d');x.drawImage(img,0,0);
    return {edge:Array.from(x.getImageData(0,0,1,1).data),photo:Array.from(x.getImageData(40,200,1,1).data)};
  });
  assert.deepEqual(background.edge,[255,254,248,255]);assert.deepEqual(background.photo,[223,255,69,255]);
  assert.ok(framing.top>160);assert.ok(framing.bottom<800);assert.ok(framing.torso>1000);assert.equal(framing.ruled,0);
  assert.equal(await page.evaluate(()=>window.player.storage),original);
  await page.evaluate(()=>{window.config.photoBooth.stepMs=500;window.player.avatarFileName='sheet.png';window.config.photoBooth.avatarFrame={width:48,height:64,index:0};window.player.name='변경된 닉네임';});
  await photo().locator('#retake').click();await photo().locator('#result').waitFor();assert.ok(requests.some(u=>u.endsWith('sheet.png')));
  await photo().locator('#close').click();await frames.waitFor({state:'detached'});
  assert.equal(await page.frameLocator('iframe[data-file="stamp-ui.html"]').locator('body.photo-hidden').count(),0);
  await page.evaluate(()=>window.player.avatarFileName='');await hit();await photo().locator('#error').waitFor();
  assert.match(await photo().locator('#error-text').textContent(),/아바타 정보가 없습니다/);
  await page.evaluate(()=>window.player.avatarFileName='failed.png');await photo().locator('#retry').click();await photo().locator('#error').waitFor();
  assert.equal(await photo().locator('#result').isVisible(),false);
  await page.evaluate(()=>window.player.avatarFileName='no-cors.png');await photo().locator('#retry').click();await photo().locator('#error').waitFor();assert.equal(await photo().locator('#result').isVisible(),false);
  await page.evaluate(()=>{window.player.avatarFileName='demo.png';window.config.photoBooth.avatarFrame={width:0,height:0,index:0};});await photo().locator('#retry').click();await photo().locator('#result').waitFor();
  await photo().locator('#close').focus();await page.keyboard.press('Escape');await frames.waitFor({state:'detached'});
  await hit();await photo().locator('#number').filter({hasText:'3'}).waitFor();
  await photo().locator('body').evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await frames.waitFor({state:'detached'});
  const mobile=await browser.newPage({hasTouch:true,isMobile:true,viewport:{width:390,height:700}});
  await mobile.route('https://cdn-static.zep.us/static/assets/baked-avartar-images/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from(fixture.single,'base64'),headers:{'access-control-allow-origin':'*'}}));
  await mobile.setContent(assets['photo-booth.html']);
  await mobile.evaluate(()=>window.postMessage({type:'photo_start',avatarUrl:'https://cdn-static.zep.us/static/assets/baked-avartar-images/demo.png',nickname:'모바일 관람객',stepMs:500,flashMs:80,avatarFrame:{width:0,height:0,index:0}},'*'));
  await mobile.locator('#result').waitFor();
  for(const size of [{width:390,height:700},{width:320,height:568},{width:844,height:390},{width:568,height:320}]){
    await mobile.setViewportSize(size);
    const card=await mobile.locator('#card').boundingBox(),close=await mobile.locator('#close').boundingBox();
    assert.ok(card.x>=0&&card.x+card.width<=size.width);assert.ok(close.y>=70&&close.y+close.height<=size.height-75);
  }
  await mobile.setViewportSize({width:390,height:700});await mobile.screenshot({path:'/tmp/avatar-polaroid-mobile-v1.11.2.png'});
  await mobile.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});assert.equal(await mobile.locator('#result').isVisible(),true);
  await mobile.evaluate(()=>{Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.shared={size:data.files[0].size,type:data.files[0].type};}});});
  await mobile.locator('#save').tap();assert.equal(await mobile.evaluate(()=>window.shared.type),'image/png');assert.ok(await mobile.evaluate(()=>window.shared.size>1000));
  await mobile.locator('#close').tap();
  await mobile.close();assert.deepEqual(errors,[]);
  console.log('PASS avatar CDN loading, full avatar framing, sheet extraction, 3-2-1/flash, PNG download 832x1088, retake, errors, mobile bounds and touch');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
