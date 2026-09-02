// Test helper: joins as a normal player and answers when asked.
import WebSocket from 'ws';

const [, , name, answer] = process.argv;
const socket = new WebSocket('ws://127.0.0.1:3000/ws');
let joined = false;

socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'player' })));

socket.on('message', (data) => {
  const message = JSON.parse(data.toString());

  if (message.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));

  if (message.type === 'welcome' && !joined) {
    joined = true;
    socket.send(JSON.stringify({ type: 'join', name }));
  }

  if (message.type === 'join_accepted') console.log(`${name} joined`);
  if (message.type === 'join_rejected') console.log(`${name} rejected: ${message.message}`);

  if (message.type === 'view' && message.player?.kind === 'choose') {
    if (message.player.selectedOptionId === null) {
      socket.send(JSON.stringify({ type: 'submit', value: answer }));
      console.log(`${name} answered ${answer}`);
    }
  }

  if (message.type === 'view' && message.player?.kind === 'round_result') {
    console.log(`${name} result: ${message.player.message} (correct=${message.player.correct})`);
  }
});
