import fs from 'fs';

async function run() {
  const res = await fetch('https://api.sirv.com/v2/docs');
  const text = await res.text();
  fs.writeFileSync('sirv_docs.html', text);
}
run();
