/* Optional browser integration check; requires Playwright + Chromium. */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const Zip=require('../tools/zip.js');

(async()=>{
 const root=path.resolve(__dirname,'..'),scratch=process.argv[2]||path.join(require('node:os').tmpdir(),'zep-npc-browser-check');fs.mkdirSync(scratch,{recursive:true});
 const png=fs.readFileSync(path.join(root,'zep/npc.png'));
 const legacy={file:'npc.png',frameWidth:32,frameHeight:48,frameRate:6,animations:{down:[0,1,2],left:[3,4,5],right:[6,7,8],up:[9,10,11],down_idle:[1],left_idle:[4],right_idle:[7],up_idle:[10]}};
 const oldZip=path.join(scratch,'legacy-app.zip');fs.writeFileSync(oldZip,Zip.create([{name:'main.js',data:new TextEncoder().encode('var NPC_CONFIG={};\nNPC_CONFIG.sprite = '+JSON.stringify(legacy)+';\n')},{name:'npc.png',data:png}]));
 const browser=await chromium.launch({headless:true,executablePath:process.env.NPC_BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:1100},acceptDownloads:true});const errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  const load=async()=>{await page.goto('about:blank');await page.setContent(fs.readFileSync(path.join(root,'dist/zep-npc-offline-builder.html'),'utf8'));};
  await load();await page.locator('#file').setInputFiles(path.join(root,'zep/npc.png'));await page.waitForFunction(()=>document.querySelectorAll('#frames button').length>0);
  await page.locator('#fw').fill('32');await page.locator('#fh').fill('48');await page.locator('#grid').click();
  const select=async(key,index)=>{await page.locator('#mode').selectOption(key);await page.locator('#frames button[data-index="'+index+'"]').click();};
  for(const [key,index]of Object.entries({down:0,left:2,right:4,up:6,down_idle:1,left_idle:3,right_idle:5,up_idle:7,down_jump:8,left_jump:8,right_jump:8,up_jump:8,dance:9,down_sit:10,left_sit:10,right_sit:10,up_sit:10}))await select(key,index);
  await page.locator('#customId').fill('wave');await page.locator('#customLabel').fill('손 흔들기');await page.locator('#addMotion').click();await select('wave',11);
  await page.locator('#offsetX').fill('2');await page.locator('#offsetY').fill('-3');
  const downloadPromise=page.waitForEvent('download');await page.locator('#download').click();const download=await downloadPromise;
  const first=path.join(scratch,'registered-app.zip');await download.saveAs(first);const files=await Zip.read(new Uint8Array(fs.readFileSync(first)));
  assert.deepEqual(Buffer.from(files['npc.png']),png);const main=new TextDecoder().decode(files['main.js']),settings=JSON.parse(main.match(/NPC_CONFIG\.sprite\s*=\s*(\{[^\n]*\})\s*;/)[1]);
  assert.deepEqual(settings.animations.down,[0]);assert.deepEqual(settings.animations.down_idle,[1]);assert.equal(settings.actions.length,4);assert.equal(settings.displayOffsetX,2);assert.equal(settings.displayOffsetY,-3);assert.equal(settings.actions.find(a=>a.id==='jump').directional,true);assert.deepEqual(settings.animations.left_sit,[10]);assert.equal(settings.actions.find(a=>a.id==='dance').loop,true);assert.deepEqual(settings.animations.wave,[11]);
  await load();await page.locator('#existing').setInputFiles(oldZip);await page.waitForFunction(()=>document.getElementById('info').textContent.includes('불러왔어요'));
  await page.locator('#mode').selectOption('down_idle');assert.equal(await page.locator('#frames button[data-index="1"]').getAttribute('class'),'selected');
  await load();await page.locator('#existing').setInputFiles(first);await page.waitForFunction(()=>document.getElementById('info').textContent.includes('불러왔어요'));
  await page.locator('#mode').selectOption('wave');assert.equal(await page.locator('#frames button[data-index="11"]').getAttribute('class'),'selected');assert.equal(await page.locator('#loop').isChecked(),false);assert.equal(await page.locator('#offsetY').inputValue(),'-3');
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);await page.screenshot({path:path.join(scratch,'builder.png'),fullPage:true});
  const D=require('../zep/dialogue.js'),personas={moa:D.defaults('moa','friendly'),sage:D.defaults('sage','calm')};
  const characters=[{id:'moa',movementMode:'varied'},{id:'sage',movementMode:'stroll'}],movementModes=[{id:'varied',label:'짧게 배회'},{id:'stroll',label:'길게 산책'},{id:'continuous',label:'연속 이동'},{id:'patrol',label:'사각 순찰'}];
  await page.goto('about:blank');await page.setContent(fs.readFileSync(path.join(root,'zep/editor.html'),'utf8'));
  await page.evaluate(()=>{window.editorMessages=[];window.addEventListener('message',e=>{if(e.data?.type==='editor.create'||e.data?.type==='editor.save')window.editorMessages.push(e.data);});});
  await page.evaluate(data=>window.postMessage(data,'*'),{type:'editor.init',personas,characters,revision:0,styles:D.styles,movementModes});
  await page.waitForFunction(()=>document.querySelectorAll('#npc option').length===2);await page.locator('#newName').fill('친구 3');await page.locator('#newMode').selectOption('continuous');await page.locator('#create').click();
  await page.waitForFunction(()=>window.editorMessages.length===1);const creation=await page.evaluate(()=>window.editorMessages[0]);assert.equal(creation.name,'친구 3');assert.equal(creation.movementMode,'continuous');
  const third=D.defaults('npc_third','friendly');third.name='친구 3';personas.npc_third=third;characters.push({id:'npc_third',movementMode:'continuous'});
  await page.evaluate(data=>window.postMessage(data,'*'),{type:'editor.created',npcId:'npc_third',personas,characters,revision:1,styles:D.styles,movementModes});
  await page.waitForFunction(()=>document.querySelectorAll('#npc option').length===3);assert.equal(await page.locator('#npc').inputValue(),'npc_third');assert.equal(await page.locator('#movementMode').inputValue(),'continuous');
  await page.locator('#movementMode').selectOption('patrol');await page.locator('#save').click();await page.waitForFunction(()=>window.editorMessages.length===2);assert.equal(await page.evaluate(()=>window.editorMessages[1].movementMode),'patrol');
  assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('Browser OK: 4-direction jump/sit, idle, custom action, offsets, original PNG, ZIP imports, NPC create UI and movement modes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
