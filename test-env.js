const fs = require('fs');
console.log('GEMINI_API_KEY length:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0);
console.log('API_KEY length:', process.env.API_KEY ? process.env.API_KEY.length : 0);
console.log('First 4 of GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 4) : 'N/A');
fs.unlinkSync('test-env.js');
