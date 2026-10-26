// 개발용 브라우저 검증: Playwright + Chromium 필요.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
(async()=>{
 const html=fs.readFileSync(path.join(__dirname,'../prize-draw.html'));
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(html);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1024,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port;
 const packet={type:'result',rank:'2등',ball:'2',prize:'2등 경품'};
 const deliver=async d=>{await page.evaluate(d=>window.postMessage(d,'*'),d);await page.waitForTimeout(25);};
 await page.goto(url);assert.equal(await page.locator('#spinButton').isDisabled(),true);await deliver({type:'idle'});
 assert.equal(await page.locator('#spinButton').isEnabled(),true);assert.equal(await page.locator('#wheel path[data-rank]').count(),5);
 for(let i=1;i<=5;i++)assert.equal(await page.locator('#wheel text').nth(i-1).textContent(),i+'등');
 assert.match(await page.locator('#title').textContent(),/2026 용봉학술제.*AICOSS 이벤트/);
 const popupText=await page.locator('.card').innerText();for(const removed of ['LUCKY ROULETTE','회차당 계정별 한 번의 행운','당첨 후 운영 안내','1등부터 5등까지','나의 경품은 무엇일까요','당첨 확률','5%'])assert.ok(!popupText.includes(removed),removed+' 삭제');
 await page.screenshot({path:path.join(__dirname,'../../prize-popup-desktop.jpg'),type:'jpeg',quality:85});
 await page.evaluate(()=>{window.spins=0;addEventListener('message',e=>{if(e.data?.type==='spin')window.spins++;});});
 await page.locator('#spinButton').click();await page.locator('#spinButton').evaluate(e=>e.click());assert.equal(await page.evaluate(()=>window.spins),1);
 const start=Date.now();await deliver(packet);await page.waitForTimeout(350);assert.equal(await page.locator('#result').isVisible(),false);
 assert.match(await page.locator('#wheel').evaluate(e=>e.style.transition),/3000ms/);
 await page.waitForFunction(()=>!document.getElementById('result').hidden);const duration=Date.now()-start;assert.ok(duration>=2800&&duration<3900,'약 3초에 정지: '+duration);
 assert.equal(await page.locator('#rank').textContent(),'2등 당첨!');
 const angle=await page.locator('#wheel').evaluate(e=>{const v=getComputedStyle(e).transform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);return (Math.atan2(v[1],v[0])*180/Math.PI+360)%360;});assert.ok(Math.abs(angle-288)<.1);
 await deliver({...packet,rank:'1등',ball:'1'});assert.equal(await page.locator('#rank').textContent(),'2등 당첨!');
 await page.waitForTimeout(200);assert.equal(await page.locator('.confetti').evaluate(c=>{const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=3;i<a.length;i+=4)if(a[i]>0)return true;return false;}),true,'정지 후 콘페티가 그려져야 함');
 await page.setViewportSize({width:360,height:800});await page.screenshot({path:path.join(__dirname,'../../prize-popup-mobile.jpg'),type:'jpeg',quality:85,fullPage:true});
 assert.equal(await page.locator('.card').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),true);
 for(let rank=1;rank<=5;rank++){
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto(url);await deliver({type:'idle'});await page.locator('#spinButton').click();await deliver({...packet,rank:rank+'등',ball:String(rank)});await page.waitForFunction(()=>!document.getElementById('result').hidden);
  const deg=await page.locator('#wheel').evaluate(e=>parseFloat(e.style.transform.match(/rotate\(([^d]+)/)[1]));assert.equal(deg,(360-(rank-1)*72)%360);
  assert.equal(await page.locator('#rank').textContent(),rank+'등 당첨!');assert.equal(await page.locator('#spinButton').isDisabled(),true);
 }
 await page.goto(url);await deliver({type:'notice',message:'현재 추첨이 중지되어 있습니다.'});assert.equal(await page.locator('#result').isVisible(),false);assert.match(await page.locator('#statusText').textContent(),/중지/);
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto(url);await deliver({type:'idle'});await page.locator('#spinButton').click();await deliver({...packet,prize:'<img src=x onerror=alert(1)>'});await page.waitForFunction(()=>!document.getElementById('result').hidden);assert.equal(await page.locator('#prize img').count(),0);


 await page.goto(url);await deliver({type:'idle'});await page.locator('#spinButton').click();await deliver({type:'notice',message:'일시적인 오류입니다.'});
 assert.equal(await page.locator('#retryButton').isVisible(),true);await page.locator('#retryButton').click();await deliver({type:'idle'});assert.equal(await page.locator('#spinButton').isEnabled(),true);
 await page.locator('#spinButton').click();await deliver({...packet,ranks:Array.from({length:5},(_,i)=>({name:'등수'+(i+1),ball:String(i+1)}))});await page.waitForFunction(()=>!document.getElementById('result').hidden);
 assert.equal(await page.locator('#wheel text').nth(4).textContent(),'등수5');assert.equal(await page.locator('#receipt').count(),0);
 for(const [width,height] of [[320,568],[360,640],[375,667],[390,844],[430,932],[768,1024],[844,390]]){
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width,height});await page.goto(url);await deliver({type:'idle'});await page.waitForTimeout(50);
  let fits=await page.locator('.card').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;});if(!fits)console.log(await page.locator('.card').evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),client:e.clientWidth,scroll:e.scrollWidth,viewport:[innerWidth,innerHeight],stage:document.querySelector('.wheel-stage').getBoundingClientRect().toJSON()})));assert.ok(fits,'모바일 가로 넘침 '+width+'x'+height);
  const clickFits=await page.locator('#spinButton').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1;});assert.ok(clickFits,'버튼이 초기 화면 안에 표시 '+width+'x'+height);
  await page.locator('#spinButton').click();await deliver(packet);await page.waitForFunction(()=>!document.getElementById('result').hidden);await page.waitForTimeout(50);
  const resultFits=await page.locator('#result').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;});assert.ok(resultFits,'당첨 결과 화면 안에 표시 '+width+'x'+height);
 }
 assert.deepEqual(errors,[]);await browser.close();server.close();console.log('Roulette browser checks passed: 5 sectors, button-only spin, 3-second deceleration, exact stop angle for every rank, confetti, mobile, replay, notice, reduced motion, text escaping.');
})().catch(e=>{console.error(e);process.exit(1);});
