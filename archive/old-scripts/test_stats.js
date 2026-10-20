const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/admin/stats',
  method: 'GET',
  headers: {
    'x-admin-token': Buffer.from('mohseny:M2y@01287644099').toString('base64')
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});
req.end();
