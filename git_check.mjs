import { execSync } from 'child_process';

const output = execSync('git log -p src/pages/Admin.tsx').toString();
const idx = output.indexOf('generateAIDescription');
if(idx > -1) {
  console.log(output.substring(idx - 1000, idx + 2000));
} else {
  console.log("Not found");
}
