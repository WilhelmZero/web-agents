import { createServer } from 'node:http';
import { createStudioServer } from './index.mjs';

// Hostinger expects the entry point to listen within three seconds. Database
// setup can take longer, so bind first and serve requests once it completes.
let app;
let startupFailed = false;
const server = createServer((req, res) => {
  if (app) return app(req, res);
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '5' });
  res.end(startupFailed ? 'Studio is unavailable. Please try again later.' : 'Studio is starting. Please retry shortly.');
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => console.log(`Studio listener ready on ${port}`));

createStudioServer().then((result) => {
  app = result.app;
  console.log('Studio application ready');
}).catch((error) => {
  startupFailed = true;
  console.error('Studio startup failed:', error);
});
