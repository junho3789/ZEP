/* Platform-independent controller. Coordinates are integer tiles.
 * Adapter must use authoritative positions and validate collision at every step.
 */
function NpcController(adapter, config) {
  this.a=adapter;
  this.c=Object.assign({stopRadius:2,resumeRadius:4,stepSeconds:0.55,minX:0,maxX:20,minY:0,maxY:20},config);
  if (this.c.resumeRadius<=this.c.stopRadius) throw new Error('resumeRadius must exceed stopRadius');
  this.state='roaming'; this.timer=0; this.direction=null; this.steps=0;
  this.sessions={};
}
NpcController.prototype.distance=function(p,q) { return Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y)); };
NpcController.prototype.tick=function(dt) {
  if(this.state==='error') return;
  var a=this.a,c=this.c,npc=a.position(),players=a.players(),nearest=Infinity;
  for(var i=0;i<players.length;i++) nearest=Math.min(nearest,this.distance(npc,players[i]));
  for(var id in this.sessions) {
    var found=players.find(function(p){return String(p.id)===id;});
    if(!found || this.distance(npc,found)>c.resumeRadius) { a.closeChat(id); delete this.sessions[id]; }
  }
  if(this.state==='roaming' && nearest<=c.stopRadius) { this.state='waiting'; this.steps=0; a.stop(); }
  if(this.state==='waiting' && nearest>c.resumeRadius) { this.state='roaming'; this.timer=0.5; }
  if(this.state!=='roaming') return;
  if(typeof a.busy==='function' && a.busy()) {this.timer=Math.max(0,this.timer-dt);return;}
  this.timer-=dt;
  if(this.timer>0) return;
  if(this.steps<=0) {
    a.stop();
    var dirs=[[1,0],[-1,0],[0,1],[0,-1]];
    this.direction=dirs[Math.floor(Math.random()*dirs.length)];
    this.steps=2+Math.floor(Math.random()*4);
    this.timer=0.5+Math.random()*1.5;
    return;
  }
  var x=npc.x+this.direction[0],y=npc.y+this.direction[1];
  if(x<c.minX || x>c.maxX || y<c.minY || y>c.maxY || !a.canWalk(x,y)) {this.steps=0;this.timer=0.3;a.stop();return;}
  if(a.step(x,y,c.stepSeconds)===false) {this.steps=0;this.timer=0.3;a.stop();return;}
  this.steps--; this.timer=c.stepSeconds;
};
NpcController.prototype.interact=function(player) {
  if(this.distance(this.a.position(),player)>this.c.stopRadius) return false;
  this.state='waiting'; this.a.stop(); this.sessions[String(player.id)]=true; this.a.openChat(player); return true;
};
NpcController.prototype.close=function(id) {delete this.sessions[String(id)];};
if(typeof module!=='undefined') module.exports=NpcController;
