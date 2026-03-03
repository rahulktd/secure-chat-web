import { useState, useRef, useEffect } from 'react';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

// NEW: Dictionary for random names
const generateRandomName = () => {
  const adjs = ['Neon', 'Cyber', 'Stealth', 'Quantum', 'Cosmic', 'Void', 'Crypto', 'Rogue'];
  const nouns = ['Ninja', 'Tiger', 'Ghost', 'Rider', 'Dragon', 'Phantom', 'Wolf', 'Hacker'];
  const adj = adjs[Math.floor(Math.random() * adjs.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 100);
  return `${adj}${noun}${num}`;
};

function App() {
  const [username, setUsername] = useState(''); // NEW: Tracks the user's name
  const [roomCode, setRoomCode] = useState('');
  const [msgInput, setMsgInput] = useState('');
  const [logs, setLogs] = useState(['System: Ready to connect...']);
  const [isConnected, setIsConnected] = useState(false);

  const ws = useRef(null);
  const myKeys = useRef(null);
  const peerKey = useRef(null);
  const logEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // NEW: On Initial Load - Set random name and check URL for room code
  useEffect(() => {
    setUsername(generateRandomName()); // Assign a random name immediately

    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      setRoomCode(urlRoom.toUpperCase()); // Auto-fill if ?room= exists in URL
    }

    // Cleanup ghost connections
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  const addLog = (msg) => setLogs((prev) => [...prev, msg]);

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newCode = '';
    for (let i = 0; i < 6; i++) {
      newCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(newCode);
    
    // NEW: Automatically update the browser URL so the user can easily copy/share it
    window.history.pushState({}, '', `?room=${newCode}`);
  };

  const joinRoom = () => {
    if (!roomCode.trim()) return;
    
    // Ensure the URL matches the room we just joined (if they typed it manually)
    window.history.pushState({}, '', `?room=${roomCode}`);

    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      ws.current.close();
    }

    myKeys.current = nacl.box.keyPair();
    const myPublicKeyHex = toHex(myKeys.current.publicKey);

    // Make sure your exact Hugging Face URL is here!
    const uri = `wss://rahulktd-secure-terminal-chat.hf.space/ws/chat/${roomCode}/`;
    ws.current = new WebSocket(uri);

    ws.current.onopen = () => {
      setIsConnected(true);
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
      else if (data.type === 'encrypted_message') {
        if (data.sender_key !== myPublicKeyHex && peerKey.current) {
          try {
            const payloadBytes = fromHex(data.payload);
            const nonce = payloadBytes.slice(0, nacl.box.nonceLength);
            const ciphertext = payloadBytes.slice(nacl.box.nonceLength);
            const decryptedBytes = nacl.box.open(ciphertext, nonce, peerKey.current, myKeys.current.secretKey);

            if (decryptedBytes) {
              // NEW: We just print exactly what the peer sends, since their username is baked into the message
              addLog(`[Incoming] ${util.encodeUTF8(decryptedBytes)}`);
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
    ws.current.onclose = () => {
      addLog('System: Disconnected.');
      setIsConnected(false);
      peerKey.current = null;
    };
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!msgInput.trim() || !peerKey.current || !ws.current) return;

    // NEW: Bake the username directly into the message text before encrypting
    const finalName = username.trim() || 'Anonymous';
    const formattedMessage = `${finalName}: ${msgInput}`;

    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const msgBytes = util.decodeUTF8(formattedMessage);
    const ciphertext = nacl.box(msgBytes, nonce, peerKey.current, myKeys.current.secretKey);

    const payload = new Uint8Array(nonce.length + ciphertext.length);
    payload.set(nonce);
    payload.set(ciphertext, nonce.length);

    ws.current.send(JSON.stringify({
      type: 'encrypted_message',
      sender_key: toHex(myKeys.current.publicKey),
      payload: toHex(payload)
    }));

    // Update local log to show you sent it
    addLog(`[You] ${finalName}: ${msgInput}`);
    setMsgInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', color: '#00ff00', fontFamily: "'Courier New', Courier, monospace" }}>

      {/* 1. Header Bar */}
      <div style={{ padding: '15px 25px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>[ Secure Web Messenger ]</h2>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* NEW: Username Input Field */}
          <span style={{ color: '#888', fontSize: '0.9rem' }}>ID:</span>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isConnected}
            style={{ padding: '8px 10px', background: '#000', color: '#00ffff', border: '1px solid #333', outline: 'none', width: '130px', textAlign: 'center' }}
          />

          <button onClick={generateCode} disabled={isConnected} style={{ padding: '8px 15px', background: '#333', color: '#fff', cursor: isConnected ? 'not-allowed' : 'pointer', border: '1px solid #555', fontSize: '0.9rem' }}>
            NEW ROOM
          </button>

          <input
            type="text"
            placeholder="Room Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            disabled={isConnected}
            style={{ padding: '8px 15px', background: '#000', color: '#00ff00', border: '1px solid #333', outline: 'none', width: '100px', textAlign: 'center' }}
          />
          
          <button onClick={joinRoom} disabled={isConnected} style={{ padding: '8px 20px', background: isConnected ? '#555' : '#00ff00', color: '#000', cursor: isConnected ? 'not-allowed' : 'pointer', fontWeight: 'bold', border: 'none' }}>
            {isConnected ? 'CONNECTED' : 'CONNECT'}
          </button>
        </div>
      </div>

      {/* 2. Fullscreen Chat Log */}
      <div style={{ flexGrow: 1, padding: '25px', overflowY: 'auto', background: '#0a0a0a', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {logs.map((log, index) => (
          <div key={index} style={{
            color: log.startsWith('[You]') ? '#fff' : log.startsWith('[Incoming]') ? '#ff00ff' : '#00aa00',
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