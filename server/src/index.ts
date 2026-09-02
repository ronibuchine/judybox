import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WS_PATH, type ConnectionInfo } from '@judybox/shared';
import { loadConfig } from './config.js';
import { ConnectionRegistry } from './connections.js';
import { loadPartyPack, PartyPackError, DEFAULT_ASSETS_ROOT } from './content.js';
import { GameEngine } from './engine/engine.js';
import { Session } from './session.js';
import { selectLanAddress } from './net/lan.js';
import { renderQrDataUrl, renderQrForTerminal } from './net/qr.js';
import { attachWebSocketServer } from './ws.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = resolve(here, '../../client/dist');

/**
 * Calls our own advertised URL over the network stack. Catches the cases that
 * address detection cannot see: VPN clients that capture the LAN subnet,
 * firewall blocks, and adapters that are up but not routable.
 */
async function verifyAdvertisedUrlReachable(joinUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/health', joinUrl), {
      signal: AbortSignal.timeout(2_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function printUnreachableWarning(joinUrl: string): void {
  console.log('\n  ------------------------------------------------------------');
  console.log(`  WARNING: ${joinUrl} is NOT reachable from this laptop.`);
  console.log('  Phones will not be able to join until this is fixed.\n');
  console.log('  Most likely causes, in order:');
  console.log('    1. A VPN is capturing your LAN. Cisco AnyConnect, GlobalProtect');
  console.log('       and Zscaler often route 192.168.x.x into the corporate tunnel.');
  console.log('       Disconnect the VPN, then restart JudyBox.');
  console.log('    2. Windows Firewall is blocking Node on private networks.');
  console.log('    3. The wrong adapter was chosen - see the list above and');
  console.log('       restart with JUDYBOX_HOST=<correct address>.');
  console.log('  ------------------------------------------------------------\n');
}

async function main(): Promise<void> {
  const config = loadConfig();
  const lan = selectLanAddress(undefined, config.hostOverride);
  const joinUrl = `http://${lan.address}:${config.port}/`;

  let pack;
  try {
    pack = loadPartyPack(config.packId);
  } catch (error) {
    if (error instanceof PartyPackError) {
      console.error(`\n[fatal] Party pack problem:\n        ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const registry = new ConnectionRegistry();
  const session = new Session(pack.specialPlayerName);
  const engine = new GameEngine({
    games: pack.games,
    specialPlayerName: pack.specialPlayerName,
  });
  const qrDataUrl = await renderQrDataUrl(joinUrl);

  const app = express();

  // Round images and other party media.
  app.use('/assets', express.static(DEFAULT_ASSETS_ROOT, { fallthrough: true }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, sessionId: registry.sessionId, presence: registry.presence() });
  });

  app.get('/api/connection-info', (_req, res) => {
    const info: ConnectionInfo = {
      joinUrl,
      qrDataUrl,
      lanAddress: lan.address,
      port: config.port,
      sessionId: registry.sessionId,
      partyName: pack.name,
      contentWarnings: pack.warnings,
    };
    res.json(info);
  });

  const hasBuiltClient = existsSync(resolve(CLIENT_DIST, 'index.html'));
  if (hasBuiltClient) {
    app.use(express.static(CLIENT_DIST));
    // SPA fallback: /host and /display are client-side routes, not files.
    app.get('*', (_req, res) => {
      res.sendFile(resolve(CLIENT_DIST, 'index.html'));
    });
  } else {
    app.get('*', (_req, res) => {
      res
        .status(503)
        .type('text/plain')
        .send(
          'JudyBox: no client build found.\n\n' +
            'Development:  npm run dev    (then open http://localhost:5173)\n' +
            'Party mode:   npm run party  (builds the client, then serves it here)\n',
        );
    });
  }

  const httpServer = createServer(app);
  attachWebSocketServer(httpServer, registry, session, engine);

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\n[fatal] Port ${config.port} is already in use.\n` +
          `        Another JudyBox may still be running, or pick a port: JUDYBOX_PORT=3001 npm run start\n`,
      );
      process.exit(1);
    }
    if (error.code === 'EADDRNOTAVAIL') {
      console.error(
        `\n[fatal] Cannot bind to ${config.bindHost} - no interface has that address.\n` +
          `        Unset JUDYBOX_BIND to listen on all interfaces.\n`,
      );
      process.exit(1);
    }
    if (error.code === 'EACCES') {
      console.error(
        `\n[fatal] Not allowed to bind port ${config.port}. Try a port above 1024.\n`,
      );
      process.exit(1);
    }
    throw error;
  });

  httpServer.listen(config.port, config.bindHost, async () => {
    const qr = await renderQrForTerminal(joinUrl);
    console.log('\n=========================================');
    console.log('  JUDYBOX SERVER');
    console.log('=========================================\n');
    console.log(qr);
    console.log(`  Party pack:  ${pack.name} (${pack.id})`);
    console.log(`  Special player: ${pack.specialPlayerName}`);
    console.log(`  Games: ${pack.games.map((game) => game.name).join(', ') || 'none'}\n`);
    console.log('  Local:');
    console.log(`    http://localhost:${config.port}\n`);
    console.log('  LAN (scan the QR, or type this on a phone):');
    console.log(`    ${joinUrl}\n`);
    console.log('  WebSocket:');
    console.log(`    ws://${lan.address}:${config.port}${WS_PATH}\n`);
    console.log('  TV display:    ' + `${joinUrl}display`);
    console.log('  Host controls: ' + `${joinUrl}host`);
    if (!hasBuiltClient) {
      console.log('\n  (No client build yet - run `npm run dev` for development UI.)');
    }
    console.log(`\n  Network interfaces (bound to ${config.bindHost}, best first):`);
    for (const candidate of lan.candidates) {
      const marker = candidate.address === lan.address ? '*' : ' ';
      console.log(
        `   ${marker} ${candidate.address.padEnd(15)} score ${String(candidate.score).padStart(4)}  ${candidate.iface} - ${candidate.reason}`,
      );
    }
    if (lan.forced) console.log(`\n  Address forced via JUDYBOX_HOST=${lan.address}`);
    for (const warning of config.warnings) console.log(`\n  Config warning: ${warning}`);
    if (pack.warnings.length > 0) {
      console.log('\n  Content warnings (the party will still run):');
      for (const warning of pack.warnings) console.log(`    - ${warning}`);
    }
    console.log('\n  Wrong address? Restart with: JUDYBOX_HOST=192.168.x.x npm run start\n');

    if (await verifyAdvertisedUrlReachable(joinUrl)) {
      console.log('  Self-check passed: phones on this Wi-Fi should be able to join.');
      console.log('\n  Ready.\n');
    } else {
      printUnreachableWarning(joinUrl);
    }
  });

  const shutdown = (): void => {
    console.log('\n[server] shutting down');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('[fatal]', error);
  process.exit(1);
});
