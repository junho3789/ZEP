const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const Zip=require('../tools/zip.js');
test('browser packager creates a valid ZIP and preserves original sprite bytes',()=>{
 const png=require('node:fs').readFileSync(require('node:path').join(__dirname,'../zep/npc.png'));
 const archive=Zip.create([{name:'main.js',data:new TextEncoder().encode('const name = "모아";')},{name:'npc.png',data:png}]);
 const fs=require('node:fs'),path=require('node:path'),dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'npc-zip-'));
 try {
  const zipPath=path.join(dir,'test.zip'),pngPath=path.join(dir,'original.png');fs.writeFileSync(zipPath,archive);fs.writeFileSync(pngPath,png);
  const code='import sys,zipfile,pathlib\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nassert z.namelist()==["main.js","npc.png"]\nassert z.read("main.js").decode()==\'const name = "모아";\'\nassert z.read("npc.png")==pathlib.Path(sys.argv[2]).read_bytes()';
  const result=spawnSync('python3',['-c',code,zipPath,pngPath],{timeout:10000});assert.equal(result.status,0,String(result.stderr));
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing app ZIP can be reloaded with exact PNG bytes and detects corruption',async()=>{
 const original=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
 const archive=Zip.create([{name:'main.js',data:new TextEncoder().encode('NPC_CONFIG.sprite = {"frameWidth":48};')},{name:'npc.png',data:original}]);
 const files=await Zip.read(archive);assert.deepEqual(files['npc.png'],original);assert.match(new TextDecoder().decode(files['main.js']),/frameWidth/);
 const corrupt=archive.slice();corrupt[30+'main.js'.length]^=1;await assert.rejects(()=>Zip.read(corrupt),/검증/);
});
test('compressed app ZIPs are read without changing image bytes',async()=>{
 const fs=require('node:fs'),path=require('node:path'),dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'npc-read-'));
 try{
  const target=path.join(dir,'app.zip');const result=spawnSync('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED) as z:z.writestr("npc.png",b"exact original bytes")',target],{timeout:10000});assert.equal(result.status,0,String(result.stderr));
  const files=await Zip.read(new Uint8Array(fs.readFileSync(target)));assert.equal(new TextDecoder().decode(files['npc.png']),'exact original bytes');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
