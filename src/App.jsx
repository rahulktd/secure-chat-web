import { useState, useRef, useEffect } from 'react';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

// Helper functions for hex conversion
const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

function App() {
  const [roomCode, setRoomCode] = useState('');
  const [msgInput, setMsgInput] = useState('');
  const [logs, setLogs] = useState(['System: Ready to connect...']);

  const ws = useRef(null);
  const myKeys = useRef(null);
  const peerKey = useRef(null);
  const logEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg) => setLogs((prev) => [...prev, msg]);

  const joinRoom = () => {
    if (!roomCode.trim()) return;

    myKeys.current = nacl.box.keyPair();
    const myPublicKeyHex = toHex(myKeys.current.publicKey);

    // Make sure your exact Hugging Face URL is here!
    const uri = `wss://rahulktd-secure-terminal-chat.hf.space/ws/chat/${roomCode}/`;
    ws.current = new WebSocket(uri);

    ws.current.onopen = () => {
      addLog(`System: Connected to room ${roomCode}. Waiting for peer...`);
      ws.current.send(JSON.stringify({
        type: 'key_exchange',
        public_key: myPublicKeyHex
      }));
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'key_exchange') {
        if (data.public_key !== myPublicKeyHex) {
          if (!peerKey.current) {
            peerKey.current = fromHex(data.public_key);
            addLog('System: Peer connected! E2EE established. You can now chat.');

            ws.current.send(JSON.stringify({
              type: 'key_exchange',
              public_key: myPublicKeyHex
            }));
          }
        }
      }
      // Handle Incoming Encrypted Messages
      else if (data.type === 'encrypted_message') {
        if (data.sender_key !== myPublicKeyHex && peerKey.current) {
          try {
            const payloadBytes = fromHex(data.payload);

            // PyNaCl prepends a 24-byte nonce. We must slice it off.
            const nonce = payloadBytes.slice(0, nacl.box.nonceLength);
            const ciphertext = payloadBytes.slice(nacl.box.nonceLength);

            // Decrypt the message
            const decryptedBytes = nacl.box.open(ciphertext, nonce, peerKey.current, myKeys.current.secretKey);

            if (decryptedBytes) {
              addLog(`Peer: ${util.encodeUTF8(decryptedBytes)}`);
            } else {
              addLog('System: Failed to decrypt message.');
            }
          } catch (e) {
            addLog(`System: Decryption error - ${e.message}`);
          }
        }
      }
    };

    ws.current.onerror = () => addLog('System: Connection Error.');
    ws.current.onclose = () => addLog('System: Disconnected.');
  };

  // Handle Outgoing Encrypted Messages
  const sendMessage = (e) => {
    e.preventDefault(); // Prevent page refresh on enter
    if (!msgInput.trim() || !peerKey.current || !ws.current) return;

    // Generate a random 24-byte nonce
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msgBytes = util.decodeUTF8(msgInput);

    // Encrypt the message
    const ciphertext = nacl.box(msgBytes, nonce, peerKey.current, myKeys.current.secretKey);

    // Glue the nonce and ciphertext together (exactly how Python PyNaCl expects it)
    const payload = new Uint8Array(nonce.length + ciphertext.length);
    payload.set(nonce);
    payload.set(ciphertext, nonce.length);

    ws.current.send(JSON.stringify({
      type: 'encrypted_message',
      sender_key: toHex(myKeys.current.publicKey),
      payload: toHex(payload)
    }));

    addLog(`You: ${msgInput}`);
    setMsgInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', color: '#00ff00', fontFamily: "'Courier New', Courier, monospace" }}>

      {/* 1. Header Bar */}
      <div style={{ padding: '15px 25px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>[ Secure Web Messenger ]</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder="Room Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            style={{ padding: '8px 15px', background: '#000', color: '#00ff00', border: '1px solid #333', outline: 'none', width: '120px', textAlign: 'center' }}
          />
          <button onClick={joinRoom} style={{ padding: '8px 20px', background: '#00ff00', color: '#000', cursor: 'pointer', fontWeight: 'bold', border: 'none' }}>
            CONNECT
          </button>
        </div>
      </div>

      {/* 2. Fullscreen Chat Log */}
      <div style={{ flexGrow: 1, padding: '25px', overflowY: 'auto', background: '#0a0a0a', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {logs.map((log, index) => (
          <div key={index} style={{
            color: log.startsWith('You:') ? '#fff' : log.startsWith('Peer:') ? '#ff00ff' : '#00aa00',
            lineHeight: '1.5'
          }}>
            {log}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* 3. Input Footer */}
      <div style={{ padding: '20px 25px', background: '#111', borderTop: '1px solid #333' }}>
        <form onSubmit={sendMessage} style={{ display: 'flex', gap: '15px' }}>
          <input
            type="text"
            placeholder="Type your secure message..."
            value={msgInput}
            onChange={(e) => setMsgInput(e.target.value)}
            disabled={!peerKey.current}
            style={{ flexGrow: 1, padding: '12px 15px', background: '#000', color: '#00ff00', border: '1px solid #333', outline: 'none', fontSize: '1rem' }}
          />
          <button type="submit" disabled={!peerKey.current} style={{ padding: '12px 30px', background: peerKey.current ? '#00ff00' : '#333', color: '#000', cursor: peerKey.current ? 'pointer' : 'not-allowed', fontWeight: 'bold', border: 'none', fontSize: '1rem' }}>
            SEND
          </button>
        </form>
      </div>
    </div>
  );
}

export default App;