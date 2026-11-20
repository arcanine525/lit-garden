import { createServer } from 'node:http';

createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ provider: 'mock-drive', ready: true }));
  }
  response.writeHead(404);
  response.end();
}).listen(8080, '0.0.0.0');
