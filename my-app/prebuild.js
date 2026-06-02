const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const buildTime = Date.now().toString();

let content = '';
try {
  content = fs.readFileSync(envPath, 'utf8');
  // แทน BUILD_TIME เดิม
  if (content.includes('REACT_APP_BUILD_TIME=')) {
    content = content.replace(/REACT_APP_BUILD_TIME=.*/g, `REACT_APP_BUILD_TIME=${buildTime}`);
  } else {
    content += `\nREACT_APP_BUILD_TIME=${buildTime}`;
  }
} catch {
  content = `REACT_APP_BUILD_TIME=${buildTime}`;
}

fs.writeFileSync(envPath, content);
console.log('Build time set:', buildTime);
