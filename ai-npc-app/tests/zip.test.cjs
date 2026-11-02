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
