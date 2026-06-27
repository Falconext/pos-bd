const http = require('http');

const options = {
  hostname: 'localhost',
  port: 4001,
  path: '/api/v1/kardex/libro-control-psicotropicos?fechaInicio=2026-01-01&fechaFin=2026-12-31',
  method: 'GET',
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
