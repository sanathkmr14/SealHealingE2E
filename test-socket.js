import net from 'net';
import fs from 'fs';

const pipePath = './test.pipe';
if (fs.existsSync(pipePath)) fs.unlinkSync(pipePath);

const server = net.createServer();
try {
  server.listen(pipePath, () => {
    console.log('Socket listening successfully at', pipePath);
    server.close();
  });
} catch (err) {
  console.error('Socket listen failed:', err);
}
