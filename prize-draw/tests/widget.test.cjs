// 개발용: Playwright와 Chromium 필요. 모형 서버 메시지로 브라우저 기록 동작을 검증합니다.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../prize-draw.html'));
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const errors=[],eventKey='fixture:aicoss:space:map',storeKey='aicoss:participation:v1:'+eventKey;
 const ranks=[{name:'1등'},{name:'2등'},{name:'3등'}],packet={type:'result',rank:'2등',ball:'2',prize:'2등 경품',ranks};
 const url='http://127.0.0.1:'+server.address().port;
 async function newContext(){const context=await browser.newContext({viewport:{width:1024,height:1000}});await context.addInitScript(()=>{window.__spins=0;window.__claim=null;addEventListener('message',e=>{if(e.data?.type==='spin'){window.__spins++;window.__claim=e.data.claimToken;}});});return context;}
 async function newPage(context){const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));return p;}
 async function deliver(p,d){await p.evaluate(({d,eventKey,ranks})=>window.postMessage(Object.assign({eventKey,ranks},d.type==='result'?{claimToken:window.__claim}:{},d),'*'),{d,eventKey,ranks});await p.waitForTimeout(35);}
 async function fresh(p){await p.goto(url);await p.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase('aicoss-browser-participation-v1');r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}));await p.reload();}
 async function readRecord(p){return p.evaluate(k=>new Promise((resolve,reject)=>{const open=indexedDB.open('aicoss-browser-participation-v1',1);open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('events'))open.result.createObjectStore('events');};open.onsuccess=()=>{const db=open.result,tx=db.transaction('events','readonly'),r=tx.objectStore('events').get(k);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();};open.onerror=()=>reject(open.error);}),storeKey);}
 async function writeRecord(p,value){await p.evaluate(({k,value})=>new Promise((resolve,reject)=>{const open=indexedDB.open('aicoss-browser-participation-v1',1);open.onupgradeneeded=()=>{if(!open.result.objectStoreNames.contains('events'))open.result.createObjectStore('events');};open.onsuccess=()=>{const db=open.result,tx=db.transaction('events','readwrite');tx.objectStore('events').put(value,k);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};open.onerror=()=>reject(open.error);}),{k:storeKey,value});}

 async function idle(p){await deliver(p,{type:'idle'});await p.locator('#spinButton:enabled').waitFor();}
 async function clickSpin(p){await p.locator('#spinButton').click();await p.waitForFunction(()=>window.__spins===1);}
 const context=await newContext(),page=await newPage(context);await fresh(page);await idle(page);
 assert.equal(await page.locator('#wheel path[data-rank]').count(),3);
 const popup=await page.locator('.card').innerText();for(const s of ['LUCKY ROULETTE','당첨 확률','회차당 계정별','나의 경품은 무엇일까요'])assert.ok(!popup.includes(s));
 await page.screenshot({path:path.join(__dirname,'../../prize-popup-desktop.jpg'),type:'jpeg',quality:85});
 await clickSpin(page);await page.locator('#spinButton').evaluate(e=>e.click());assert.equal(await page.evaluate(()=>window.__spins),1);
 const started=Date.now();await deliver(page,packet);await page.waitForTimeout(300);assert.equal(await page.locator('#result').isVisible(),false);
 assert.equal((await readRecord(page)).status,'done','연출 전에 결과 저장');
 await page.waitForFunction(()=>!document.getElementById('result').hidden);assert.ok(Date.now()-started>=2800);assert.equal(await page.locator('#rank').textContent(),'2등 당첨!');
 await page.waitForFunction(()=>{const c=document.querySelector('.confetti'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<a.length;i+=4)if(a[i])return true;return false;},{},{timeout:2500});
 await page.reload();await deliver(page,{type:'idle'});await page.locator('#result').waitFor();assert.equal(await page.locator('#rank').textContent(),'2등 당첨!');assert.match(await page.locator('#statusText').textContent(),/이미 참여/);assert.equal(await page.evaluate(()=>window.__spins),0);
 await page.setViewportSize({width:360,height:800});await page.screenshot({path:path.join(__dirname,'../../prize-popup-mobile.jpg'),type:'jpeg',quality:85,fullPage:true});
 const tab=await newPage(context);await tab.goto(url);await deliver(tab,{type:'idle'});await tab.locator('#result').waitFor();assert.equal(await tab.evaluate(()=>window.__spins),0);
 await tab.reload();await deliver(tab,{type:'notice',message:'현재 중지',notDrawn:true});await tab.locator('#result').waitFor();assert.match(await tab.locator('#statusText').textContent(),/이미 참여/);
 await tab.reload();await deliver(tab,{type:'idle',eventKey:'another:event'});await tab.locator('#spinButton:enabled').waitFor();await tab.close();
 // 같은 브라우저 두 탭: IndexedDB 트랜잭션으로 예약을 직렬화하고 한 탭만 추첨 요청.
 const simultaneous=await newContext(),a=await newPage(simultaneous),b=await newPage(simultaneous);
 for(let round=0;round<10;round++){
  await fresh(a);await b.goto(url);await idle(a);await idle(b);
  await Promise.all([a.locator('#spinButton').evaluate(e=>e.click()),b.locator('#spinButton').evaluate(e=>e.click())]);await a.waitForTimeout(250);
  assert.equal((await a.evaluate(()=>window.__spins))+(await b.evaluate(()=>window.__spins)),1,'동시 탭 예약 반복 '+round);
  const winner=(await a.evaluate(()=>window.__spins))?a:b,other=winner===a?b:a;await winner.emulateMedia({reducedMotion:'reduce'});await deliver(winner,packet);await other.locator('#result').waitFor();
 }
 await simultaneous.close();
 // 서버에 요청하기 전에 닫은 경우에는 참여 예약을 남기지 않음.
 await fresh(page);await idle(page);await page.evaluate(()=>{document.getElementById('spinButton').click();document.querySelector('.close').click();});await page.waitForTimeout(100);assert.equal(await readRecord(page),undefined);assert.equal(await page.evaluate(()=>window.__spins),0);
 // 회전 중 창을 닫아도 이미 저장한 결과로 복원.
 await page.emulateMedia({reducedMotion:'no-preference'});await fresh(page);await idle(page);await clickSpin(page);await deliver(page,packet);await page.waitForTimeout(100);assert.equal(await page.locator('#result').isVisible(),false);await page.reload();await deliver(page,{type:'idle'});await page.locator('#result').waitFor();assert.equal(await page.evaluate(()=>window.__spins),0);
 // 손상된 참여 정보를 미참여로 간주하거나 덮어쓰지 않음.
 await fresh(page);await writeRecord(page,'broken');await deliver(page,{type:'idle'});await page.locator('#retryButton').waitFor();assert.equal(await readRecord(page),'broken');assert.equal(await page.evaluate(()=>window.__spins),0);
 // 추첨 요청 직후 종료되면 pending을 지우지 않으며 임의 재추첨하지 않음.
 await fresh(page);await idle(page);await clickSpin(page);await page.reload();await deliver(page,{type:'idle'});await page.locator('#retryButton').waitFor();assert.equal(await page.locator('#spinButton').isDisabled(),true);assert.equal(await page.evaluate(()=>window.__spins),0);
 // 서버가 미완료를 명시한 오류는 예약 해제 후 재시도.
 await fresh(page);await idle(page);await clickSpin(page);await deliver(page,{type:'notice',message:'일시적 오류',notDrawn:true});await page.waitForTimeout(100);assert.equal(await readRecord(page),undefined);await page.locator('#retryButton').click();await idle(page);assert.equal(await page.locator('#spinButton').isEnabled(),true);
 // 결과 저장 실패 시 저장된 pending을 보존, 저장 재시도로만 복구.
 await fresh(page);await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.__failDone=true;const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,k){if(window.__failDone&&value.status==='done')throw new DOMException('quota','QuotaExceededError');return original.call(this,value,k);};});await idle(page);await clickSpin(page);await deliver(page,packet);await page.locator('#retryButton').waitFor();assert.equal(await page.locator('#result').isVisible(),false);assert.equal((await readRecord(page)).status,'pending');await page.evaluate(()=>window.__failDone=false);await page.locator('#retryButton').click();await page.locator('#result').waitFor();assert.equal(await page.evaluate(()=>window.__spins),1);
 const blocked=await newContext();await blocked.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('blocked','SecurityError');}}));const denied=await newPage(blocked);await denied.goto(url);await deliver(denied,{type:'idle'});await denied.locator('#retryButton').waitFor();assert.equal(await denied.evaluate(()=>window.__spins),0);await blocked.close();
 // 저장소 비활성 환경이 다른 브라우저/사용자를 중단시키지 않음; 3등수 각도/모바일.
 for(const [width,height]of [[320,568],[360,640],[375,667],[390,844],[430,932],[768,1024],[844,390]]){await fresh(page);await page.setViewportSize({width,height});await idle(page);await clickSpin(page);await deliver(page,packet);await page.locator('#result').waitFor();await page.waitForTimeout(40);assert.equal(await page.locator('#result').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}),true);}
 for(let rank=1;rank<=3;rank++){await fresh(page);await idle(page);await clickSpin(page);await deliver(page,{...packet,rank:rank+'등',ball:String(rank)});await page.locator('#result').waitFor();assert.equal(await page.locator('#wheel').evaluate(e=>parseFloat(e.style.transform.match(/rotate\(([^d]+)/)[1])),(360-(rank-1)*120)%360);}
 await fresh(page);await idle(page);await clickSpin(page);await deliver(page,{...packet,prize:'<img src=x onerror=alert(1)>'});await page.locator('#result').waitFor();assert.equal(await page.locator('#prize img').count(),0);
 assert.deepEqual(errors,[]);await browser.close();server.close();console.log('PASS: browser persistence/rejoin, pre-animation save, replay blocking, same-browser tabs, pending recovery, per-user storage errors, event separation, 3 ranks, 7 viewport sizes.');
})().catch(e=>{console.error(e);process.exit(1);});
