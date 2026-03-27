let socket = null;
let peerConnection = null;
let roomCode = null;
let localStream = null;
let isInitiator = false;
let isMuted = false;
let isCameraOff = false;
let pendingIceCandidates = [];
let roomExpired = false;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
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

function connectToServer(code) {
  roomCode = code;
  
  socket = io();
  
  socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus('connected', 'Connected');
    socket.emit('join-room', { roomCode, isInitiator });
  });

  socket.on('room-expired', () => {
    showEndCallOverlay('Room expired');
  });

  socket.on('peer-count', (count) => {
    console.log('Peer count:', count);
    if (count === 2 && !isInitiator) {
      createPeerConnectionAndOffer();
    }
  });

  socket.on('peer-joined', async (peerId) => {
    console.log('Peer joined:', peerId);
    if (isInitiator) {
      await createPeerConnectionAndOffer();
    }
  });

  socket.on('peer-left', (peerId) => {
    console.log('Peer left:', peerId);
    handlePeerDisconnected();
  });

  socket.on('call-ended', () => {
    console.log('Call ended by peer');
    handleCallEnded();
  });

  socket.on('offer', async ({ offer, from }) => {
    console.log('Received offer');
    await createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomCode, answer });
  });

  socket.on('answer', async ({ answer }) => {
    console.log('Received answer');
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  });

  socket.on('ice-candidate', async ({ candidate }) => {
    if (peerConnection && peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    } else {
      pendingIceCandidates.push(candidate);
    }
  });

  socket.on('chat-message', ({ text, from }) => {
    addChatMessage(text, 'received');
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from server');
    updateConnectionStatus('disconnected', 'Disconnected');
  });
}

async function createPeerConnectionAndOffer() {
  await createPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit('offer', { roomCode, offer: offer });
}

async function createPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers });
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { roomCode, candidate: event.candidate });
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
    } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
      updateConnectionStatus('disconnected', 'Peer disconnected');
    }
  };
  
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  while (pendingIceCandidates.length > 0) {
    const candidate = pendingIceCandidates.shift();
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
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

function handleCallEnded() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  showEndCallOverlay('Peer ended the call');
}

function showEndCallOverlay(message) {
  document.getElementById('endCallOverlay').querySelector('p').textContent = message;
  document.getElementById('endCallOverlay').classList.add('show');
}

function hideEndCallOverlay() {
  document.getElementById('endCallOverlay').classList.remove('show');
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
  socket.emit('chat-message', { roomCode, text });
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

function endCall() {
  if (socket) {
    socket.emit('end-call', { roomCode });
  }
  
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  
  roomExpired = true;
  showEndCallOverlay('Call ended');
}

function returnHome() {
  hideEndCallOverlay();
  
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('videoScreen').classList.remove('active');
  document.getElementById('roomInfo').style.display = 'none';
  document.getElementById('videoPlaceholder').classList.remove('hidden');
  document.getElementById('remoteLabel').textContent = 'Waiting for peer...';
  document.getElementById('roomCodeDisplay').textContent = '';
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('chatOverlay').classList.add('collapsed');
  document.getElementById('chatBubble').classList.remove('show');
  
  roomCode = null;
  isInitiator = false;
  isMuted = false;
  isCameraOff = false;
  roomExpired = false;
  
  lucide.createIcons();
}

async function createRoom() {
  if (roomExpired) {
    alert('Please refresh the page to create a new room');
    return;
  }
  
  const hasMedia = await initLocalStream();
  if (!hasMedia) return;
  
  roomCode = generateRoomCode();
  isInitiator = true;
  
  showVideoScreen();
  connectToServer(roomCode);
}

async function joinRoom(code) {
  if (roomExpired) {
    alert('This room has expired. Please ask the host to create a new room.');
    return;
  }
  
  if (!code || code.length < 4) {
    alert('Please enter a valid room code');
    return;
  }
  
  const hasMedia = await initLocalStream();
  if (!hasMedia) return;
  
  roomCode = code.toUpperCase();
  isInitiator = false;
  
  showVideoScreen();
  connectToServer(roomCode);
}

function showVideoScreen() {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('videoScreen').classList.add('active');
  document.getElementById('roomInfo').style.display = 'flex';
  document.getElementById('roomCodeDisplay').textContent = roomCode;
  document.getElementById('chatBubble').classList.add('show');
  
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

document.getElementById('returnHomeBtn').addEventListener('click', returnHome);

document.getElementById('chatBubble').addEventListener('click', () => {
  document.getElementById('chatOverlay').classList.remove('collapsed');
  document.getElementById('chatBubble').classList.remove('show');
});

document.getElementById('toggleChatBtn').addEventListener('click', () => {
  document.getElementById('chatOverlay').classList.add('collapsed');
  document.getElementById('chatBubble').classList.add('show');
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
