const SERVER_URL = window.location.origin;

let transport = null;
let peerConnection = null;
let roomCode = null;
let localStream = null;
let isInitiator = false;
let isMuted = false;
let isCameraOff = false;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function initLocalStream() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: true
    });
    
    document.getElementById('localVideo').srcObject = localStream;
    return true;
  } catch (err) {
    console.error('Error accessing media devices:', err);
    alert('Please allow camera and microphone access to start a video call.');
    return false;
  }
}

async function connectToServer(code) {
  roomCode = code;
  
  try {
    transport = new WebTransport(`${SERVER_URL}/wt/${code}`);
    await transport.ready;
    
    console.log('WebTransport connected');
    updateConnectionStatus('connected', 'Connected');
    
    setupTransportListeners();
    return true;
  } catch (err) {
    console.error('WebTransport connection error:', err);
    updateConnectionStatus('disconnected', 'Connection failed');
    return false;
  }
}

function setupTransportListeners() {
  transport.datagramsReadable.on('data', (data) => {
    try {
      const message = JSON.parse(data);
      handleSignalingMessage(message);
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });
  
  transport.closed.then(() => {
    console.log('WebTransport closed');
    updateConnectionStatus('disconnected', 'Disconnected');
  });
  
  transport.closed.catch((err) => {
    console.error('WebTransport error:', err);
    updateConnectionStatus('disconnected', 'Connection lost');
  });
}

async function sendSignalingMessage(message) {
  if (!transport || transport.closed) return;
  
  try {
    const writer = transport.datagrams.writable.getWriter();
    await writer.write(JSON.stringify(message));
    writer.releaseLock();
  } catch (e) {
    console.error('Error sending message:', e);
  }
}

async function handleSignalingMessage(message) {
  console.log('Received:', message.type);
  
  switch (message.type) {
    case 'peer-ready':
      if (!isInitiator) {
        await createPeerConnection();
        await createOffer();
      }
      break;
      
    case 'offer':
      if (!isInitiator) {
        await createPeerConnection();
        await handleOffer(message.sdp);
      }
      break;
      
    case 'answer':
      await handleAnswer(message.sdp);
      break;
      
    case 'ice-candidate':
      await handleIceCandidate(message.candidate);
      break;
      
    case 'chat':
      addChatMessage(message.text, 'received');
      break;
      
    case 'peer-disconnected':
      handlePeerDisconnected();
      break;
  }
}

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers });
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({
        type: 'ice-candidate',
        candidate: event.candidate
      });
    }
  };
  
  peerConnection.ontrack = (event) => {
    console.log('Received remote track');
    document.getElementById('remoteVideo').srcObject = event.streams[0];
    document.getElementById('videoPlaceholder').classList.add('hidden');
    document.getElementById('remoteLabel').textContent = 'Peer';
  };
  
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'connected') {
      updateConnectionStatus('connected', 'Connected');
    } else if (peerConnection.iceConnectionState === 'disconnected') {
      updateConnectionStatus('disconnected', 'Peer disconnected');
    }
  };
  
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
}

async function createOffer() {
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  
  sendSignalingMessage({
    type: 'offer',
    sdp: offer
  });
}

async function handleOffer(sdp) {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  
  sendSignalingMessage({
    type: 'answer',
    sdp: answer
  });
}

async function handleAnswer(sdp) {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIceCandidate(candidate) {
  try {
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (e) {
    console.error('Error adding ICE candidate:', e);
  }
}

function handlePeerDisconnected() {
  document.getElementById('remoteVideo').srcObject = null;
  document.getElementById('videoPlaceholder').classList.remove('hidden');
  document.getElementById('remoteLabel').textContent = 'Waiting for peer...';
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
}

function addChatMessage(text, type) {
  const messagesContainer = document.getElementById('chatMessages');
  const messageElement = document.createElement('div');
  messageElement.className = `chat-message ${type}`;
  messageElement.textContent = text;
  messagesContainer.appendChild(messageElement);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendChatMessage(text) {
  addChatMessage(text, 'sent');
  sendSignalingMessage({
    type: 'chat',
    text: text
  });
}

function updateConnectionStatus(status, text) {
  const statusElement = document.getElementById('connectionStatus');
  const statusItem = document.querySelector('.status-item');
  
  statusElement.textContent = text;
  statusItem.className = `status-item ${status}`;
  
  lucide.createIcons();
}

function toggleMic() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isMuted = !audioTrack.enabled;
      
      const btn = document.getElementById('toggleMicBtn');
      btn.classList.toggle('active', isMuted);
      btn.querySelector('i').setAttribute('data-lucide', isMuted ? 'mic-off' : 'mic');
      lucide.createIcons();
    }
  }
}

function toggleCamera() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      isCameraOff = !videoTrack.enabled;
      
      const btn = document.getElementById('toggleCameraBtn');
      btn.classList.toggle('active', isCameraOff);
      btn.querySelector('i').setAttribute('data-lucide', isCameraOff ? 'video-off' : 'video');
      lucide.createIcons();
    }
  }
}

async function createRoom() {
  const hasMedia = await initLocalStream();
  if (!hasMedia) return;
  
  roomCode = generateRoomCode();
  isInitiator = true;
  
  showVideoScreen();
  await connectToServer(roomCode);
}

async function joinRoom(code) {
  if (!code || code.length < 4) {
    alert('Please enter a valid room code');
    return;
  }
  
  const hasMedia = await initLocalStream();
  if (!hasMedia) return;
  
  roomCode = code.toUpperCase();
  isInitiator = false;
  
  showVideoScreen();
  await connectToServer(roomCode);
  
  setTimeout(async () => {
    if (!isInitiator) {
      await createPeerConnection();
      await createOffer();
    }
  }, 1000);
}

function showVideoScreen() {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('videoScreen').style.display = 'flex';
  document.getElementById('roomInfo').style.display = 'flex';
  document.getElementById('statusBar').style.display = 'flex';
  document.getElementById('roomCodeDisplay').textContent = roomCode;
  
  document.getElementById('videoScreen').classList.add('active');
  
  lucide.createIcons();
}

function endCall() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (transport) {
    transport.close();
    transport = null;
  }
  
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('videoScreen').style.display = 'none';
  document.getElementById('roomInfo').style.display = 'none';
  document.getElementById('statusBar').style.display = 'none';
  document.getElementById('videoPlaceholder').classList.remove('hidden');
  document.getElementById('remoteLabel').textContent = 'Waiting for peer...';
  document.getElementById('roomCodeDisplay').textContent = '';
  document.getElementById('chatMessages').innerHTML = '';
  
  roomCode = null;
  isInitiator = false;
  isMuted = false;
  isCameraOff = false;
  
  lucide.createIcons();
}

document.getElementById('createRoomBtn').addEventListener('click', createRoom);

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  const code = document.getElementById('roomCodeInput').value;
  joinRoom(code);
});

document.getElementById('roomCodeInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const code = document.getElementById('roomCodeInput').value;
    joinRoom(code);
  }
});

document.getElementById('copyRoomBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(roomCode);
  const btn = document.getElementById('copyRoomBtn');
  btn.querySelector('i').setAttribute('data-lucide', 'check');
  lucide.createIcons();
  setTimeout(() => {
    btn.querySelector('i').setAttribute('data-lucide', 'copy');
    lucide.createIcons();
  }, 2000);
});

document.getElementById('toggleMicBtn').addEventListener('click', toggleMic);
document.getElementById('toggleCameraBtn').addEventListener('click', toggleCamera);
document.getElementById('endCallBtn').addEventListener('click', endCall);

document.getElementById('toggleChatBtn').addEventListener('click', () => {
  document.getElementById('chatOverlay').classList.toggle('collapsed');
  const icon = document.getElementById('toggleChatBtn').querySelector('i');
  icon.setAttribute('data-lucide', document.getElementById('chatOverlay').classList.contains('collapsed') ? 'chevron-up' : 'chevron-down');
  lucide.createIcons();
});

document.getElementById('emojiBtn').addEventListener('click', () => {
  document.getElementById('emojiPicker').style.display = 
    document.getElementById('emojiPicker').style.display === 'none' ? 'flex' : 'none';
});

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById('chatInput');
    input.value += btn.textContent;
    input.focus();
  });
});

document.getElementById('sendChatBtn').addEventListener('click', () => {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (text) {
    sendChatMessage(text);
    input.value = '';
  }
});

document.getElementById('chatInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (text) {
      sendChatMessage(text);
      e.target.value = '';
    }
  }
});
