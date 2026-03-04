import { useState, useRef, useEffect } from 'react';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

const toHex = (bytes) => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

// Replace this with your exact Hugging Face URL base
const API_BASE_URL = 'https://rahulktd-secure-terminal-chat.hf.space';
const WS_BASE_URL = 'wss://rahulktd-secure-terminal-chat.hf.space';

function App() {
  // --- Auth State ---
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // --- Chat State ---
  const [roomCode, setRoomCode] = useState('');
  const [msgInput, setMsgInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [isConnected, setIsConnected] = useState(false);

  const ws = useRef(null);
  const myKeys = useRef(null);
  const peerKey = useRef(null);
  const logEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Check URL for room code on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      setRoomCode(urlRoom.toUpperCase());
    }
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  const addLog = (msg) => setLogs((prev) => [...prev, msg]);

  // --- NEW: The HTTP Login Handshake ---
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      if (response.ok) {
        const data = await response.json();
        setToken(data.access); // Save the JWT in memory
        setIsLoggedIn(true);   // Unlock the chat UI
        setLogs(['System: Authentication successful. Ready to connect...']);
      } else {
        setLoginError('Invalid credentials. Access denied.');
      }
    } catch (err) {
      setLoginError('Failed to reach authentication server.');
    }
  };

  const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let newCode = '';
    for (let i = 0; i < 6; i++) {
      newCode += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setRoomCode(newCode);
    window.history.pushState({}, '', `?room=${newCode}`);
  };

  const joinRoom = () => {
    if (!roomCode.trim() || !token) return;
    
    window.history.pushState({}, '', `?room=${roomCode}`);

    if (ws.current && ws.current.readyState !== WebSocket.CLOSED) {
      ws.current.close();
    }

    myKeys.current = nacl.box.keyPair();
    const myPublicKeyHex = toHex(myKeys.current.publicKey);

    // --- NEW: Inject the JWT token into the WebSocket URL ---
    const uri = `${WS_BASE_URL}/ws/chat/${roomCode}/?token=${token}`;
    ws.current = new WebSocket(uri);

    ws.current.onopen = () => {
      setIsConnected(true);
      addLog(`System: Connected to room ${roomCode}. Waiting for peer...`);
      ws.current.send(JSON.stringify({ type: 'key_exchange', public_key: myPublicKeyHex }));
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'key_exchange') {
        if (data.public_key !== myPublicKeyHex) {
          if (!peerKey.current) {
            peerKey.current = fromHex(data.public_key);
            addLog('System: Peer connected! E2EE established. You can now chat.');
            ws.current.send(JSON.stringify({ type: 'key_exchange', public_key: myPublicKeyHex }));
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

    ws.current.onerror = () => addLog('System: Connection Error or Unauthorized.');
    ws.current.onclose = () => {
      addLog('System: Disconnected.');
      setIsConnected(false);
      peerKey.current = null;
    };
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!msgInput.trim() || !peerKey.current || !ws.current) return;

    // Use the actual authenticated username
    const formattedMessage = `${username}: ${msgInput}`;

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

    addLog(`[You] ${username}: ${msgInput}`);
    setMsgInput('');
  };

  // --- UI: The Login Screen ---
  if (!isLoggedIn) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw', backgroundColor: '#0a0a0a', color: '#00ff00', fontFamily: "'Courier New', Courier, monospace" }}>
        <form onSubmit={handleLogin} style={{ background: '#111', padding: '40px', border: '1px solid #333', display: 'flex', flexDirection: 'column', gap: '20px', width: '350px' }}>
          <h2 style={{ margin: 0, textAlign: 'center', color: '#fff' }}>[ SECURE LOGIN ]</h2>
          {loginError && <div style={{ color: '#ff0033', textAlign: 'center', fontSize: '0.9rem' }}>{loginError}</div>}
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ padding: '12px', background: '#000', color: '#00ff00', border: '1px solid #333', outline: 'none' }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ padding: '12px', background: '#000', color: '#00ff00', border: '1px solid #333', outline: 'none' }}
          />
          <button type="submit" style={{ padding: '12px', background: '#00ff00', color: '#000', cursor: 'pointer', fontWeight: 'bold', border: 'none', marginTop: '10px' }}>
            AUTHENTICATE
          </button>
        </form>
      </div>
    );
  }

  // --- UI: The Chat Screen (Only renders if logged in) ---
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', color: '#00ff00', fontFamily: "'Courier New', Courier, monospace", overflow: 'hidden' }}>
      <div style={{ padding: '15px 25px', background: '#111', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#fff' }}>[ Secure Web Messenger ]</h2>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Logged in as: <strong style={{color: '#00ffff'}}>{username}</strong></span>

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