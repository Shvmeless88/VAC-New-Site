const https = require('https');

const data = JSON.stringify({
  clientId: 'IzfcgSMOIErYOKXIvZdIt8PHh2B',
  clientSecret: 'PTCHFIo0SuujGhGElWVQj0jcQG0d9YRaOJ2P0apWjLX+qLl2NBSkAtmjOT+yZKcR4xAsZSBcrP5R7LBwAInBcg=='
});

const options = {
  hostname: 'api.sirv.com',
  port: 443,
  path: '/v2/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const token = JSON.parse(body).token;
    console.log('Token:', token);
    
    // Search files
    const searchOptions = {
      hostname: 'api.sirv.com',
      port: 443,
      path: '/v2/files/search?query=extension%3A.spin',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };
    
    const searchReq = https.request(searchOptions, searchRes => {
      let searchBody = '';
      searchRes.on('data', d => searchBody += d);
      searchRes.on('end', () => {
        console.log('Search Results:', searchBody);
      });
    });
    searchReq.end();
  });
});

req.write(data);
req.end();
