import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from './server.mjs';

// Exercise real handlers with in-memory HTTP messages; no network listener required.
function client(server){const handler=server.listeners('request')[0];return async(path,method='GET',data,token='admin')=>{
 const req={url:path,method,headers:{authorization:'Bearer '+token},async *[Symbol.asyncIterator](){if(data!==undefined)yield Buffer.from(JSON.stringify(data));}};
 const result={};const res={writeHead(status,headers){result.status=status;result.headers=headers;},end(body){result.raw=body;try{result.data=JSON.parse(body);}catch{}}};
 await handler(req,res);return result;
};}
test('authentication, persona persistence, collisions, user/NPC isolation and revision reset',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zep-npc-'));let time=10000,fail=false,calls=[];
 const options={key:'test',secret:'bridge',adminSecret:'admin',personaFile:join(dir,'personas.json'),now:()=>time,
 fetchImpl:async(url,opts)=>{calls.push(JSON.parse(opts.body));return{ok:!fail,json:async()=>({choices:[{message:{content:'안녕하세요'}}]})};}};
 let server=createServer(options),request=client(server);
 try{
 assert.equal((await request('/admin/personas','GET',undefined,'wrong')).status,401);
 assert.equal((await request('/admin/personas','PUT',null)).status,400);
 assert.equal((await request('/chat','POST',null,'bridge')).status,400);
 assert.equal((await request('/admin/personas','GET',undefined,'bridge')).status,401);
 const p={npcId:'librarian',name:'책친구',personality:'차분함',speechStyle:'정중한 존댓말',background:'도서관 안내원'};
 let result=await request('/admin/personas','PUT',p);assert.equal(result.status,200);const saved=result.data.persona;
 assert.equal((await request('/admin/personas','PUT',p)).status,409);
 async function chat(npcId,user='u1'){time+=2000;return request('/chat','POST',{sessionId:user,npcId,message:'안녕'},'bridge');}
 assert.equal((await chat('librarian')).status,200);assert.match(calls.at(-1).messages[0].content,/책친구/);
 await chat('librarian');assert.equal(calls.at(-1).messages.length,4);
 await chat('moa');assert.equal(calls.at(-1).messages.length,2);
 await chat('librarian','u2');assert.equal(calls.at(-1).messages.length,2);
 result=await request('/admin/personas','PUT',{...p,speechStyle:'친근한 반말',expectedRevision:saved.revision});assert.equal(result.status,200);
 await chat('librarian');assert.equal(calls.at(-1).messages.length,2);assert.match(calls.at(-1).messages[0].content,/친근한 반말/);
 fail=true;assert.equal((await chat('librarian')).status,502);fail=false;
 assert.equal((await chat('unknown')).status,404);
 const metadata=await request('/characters','POST',{},'bridge');assert.equal(metadata.data.characters.librarian.name,'책친구');assert.equal(metadata.data.characters.librarian.personality,undefined);
 server=createServer(options);request=client(server);const reloaded=await request('/admin/personas');assert.equal(reloaded.data.personas.librarian.speechStyle,'친근한 반말');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('corrupt persisted settings fail closed',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zep-npc-'));
 try{const file=join(dir,'personas.json');await writeFile(file,'broken');const request=client(createServer({personaFile:file,adminSecret:'admin'}));assert.equal((await request('/admin/personas')).status,503);}
 finally{await rm(dir,{recursive:true,force:true});}
});
