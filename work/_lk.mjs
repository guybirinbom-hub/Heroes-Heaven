import fs from 'fs';
const core = JSON.parse(fs.readFileSync('public/core.json','utf8'));
const ids = process.argv.slice(2);
for (const id of ids) {
  let found = false;
  for (const b of Object.keys(core)) {
    const o = core[b];
    if (!o || typeof o !== 'object') continue;
    if (Array.isArray(o)) { const r=o.find(x=>x&&x.id===id); if(r){console.log('=== '+b+' :: '+id); console.log(JSON.stringify(r,null,1)); found=true;} }
    else if (Object.prototype.hasOwnProperty.call(o,id)) { console.log('=== '+b+' :: '+id); console.log(JSON.stringify(o[id],null,1)); found=true; }
  }
  if (!found) console.log('=== NOT FOUND: '+id);
}
