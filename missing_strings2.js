const fs=require('fs');const path=require('path');const vm=require('vm');
const dir='c:/Users/dream4net/Desktop/FeedTheAnimalsMap';
function loadLang(file){
  const src=fs.readFileSync(path.join(dir,file),'utf8');
  const win={FTA_LANGS:{}};
  vm.runInNewContext(src,{window:win,FTA_LANGS:win.FTA_LANGS});
  return win.FTA_LANGS;
}
const en=loadLang('lang-en.js').en.dict;
const enVals=new Set(Object.values(en));
const files=['404.html','cities.html','how-points.html','inbox.html','index.html','privacy.html','support.html','terms.html','community.html','leaderboard.html','activity.html','auth.html'];
function textNodes(html){
  const texts=[];
  const re=/<![^>]*>|<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g;
  let out=[];let last=0;let m;
  while((m=re.exec(html))){out.push(html.slice(last,m.index));last=m.index+m[0].length;}
  out.push(html.slice(last));
  out.join('').split(/\s*\n\s*/).forEach(s=>{
    s=s.trim();
    if(!s) return;
    if(s.startsWith('<')||s.startsWith('}')||s.startsWith('{')||s.startsWith('function')||s.startsWith('var')||s.startsWith('const')||s.startsWith('async')||s.startsWith('await')||s.startsWith('if')||s.startsWith('return')||s.startsWith('else')||s.startsWith('for')) return;
    texts.push(s);
  });
  return texts;
}
const missing={};
for(const f of files){
  const html=fs.readFileSync(path.join(dir,f),'utf8');
  const t=textNodes(html);
  const miss=t.filter(x=>!enVals.has(x)&&x.length>2);
  if(miss.length) missing[f]=miss;
}
console.log(JSON.stringify(missing,null,1).slice(0,14000));
console.log('en total keys',Object.keys(en).length);
