'use strict';

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    // Chromium can preconnect without sending a request. Stop accepting first,
    // then close those sockets so fixture teardown cannot wait indefinitely.
    server.closeAllConnections();
  });
}

module.exports = { closeServer };
