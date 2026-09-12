// Generate cryptographically secure random ID
function generateDeviceId() {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate a random fun name for the device
function generateDeviceName() {
    const adjectives = ['Quantum', 'Neon', 'Cosmic', 'Hyper', 'Sonic', 'Cyber', 'Stellar', 'Ghost', 'Phantom', 'Midnight'];
    const nouns = ['Falcon', 'Panther', 'Wolf', 'Dragon', 'Phoenix', 'Ninja', 'Rider', 'Voyager', 'Nomad', 'Sphinx'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj} ${noun}`;
}

const myDeviceId = generateDeviceId();
const myDeviceName = generateDeviceName();

let socket = null;
const devices = new Map();

// WebRTC State
let peerConnection = null;
let controlChannel = null;
let fileChannel = null;
let currentPeerId = null;
let rttInterval = null;
let pingTime = 0;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('myDeviceName').textContent = myDeviceName;
    
    document.getElementById('disconnectBtn').addEventListener('click', () => {
        disconnectPeer();
        showMainScreen();
    });

    connectWebSocket();
});

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/signal`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('Connected to signaling server');
        updateStatus('Ready', 'ready');
        
        socket.send(JSON.stringify({
            type: 'JOIN',
            senderId: myDeviceId,
            data: { name: myDeviceName }
        }));
    };
    
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
    };
    
    socket.onclose = () => {
        console.log('Disconnected from signaling server');
        updateStatus('Disconnected', '');
        devices.clear();
        renderDevices();
        setTimeout(connectWebSocket, 3000); // Reconnect attempt
    };
}

async function handleSignalingMessage(msg) {
    switch (msg.type) {
        case 'DIRECTORY':
            devices.clear();
            msg.data.forEach(d => devices.set(d.id, d));
            renderDevices();
            break;
        case 'PEER_JOINED':
            devices.set(msg.data.id, msg.data);
            renderDevices();
            break;
        case 'PEER_LEFT':
            devices.delete(msg.data.id);
            renderDevices();
            if (currentPeerId === msg.data.id) {
                disconnectPeer();
                showMainScreen();
                alert('Peer disconnected');
            }
            break;
        case 'OFFER':
            await handleOffer(msg);
            break;
        case 'ANSWER':
            await handleAnswer(msg);
            break;
        case 'ICE_CANDIDATE':
            await handleIceCandidate(msg);
            break;
    }
}

// ----------------------------------------------------
// WEBRTC LOGIC
// ----------------------------------------------------

async function initiateConnection(targetId) {
    currentPeerId = targetId;
    const targetDevice = devices.get(targetId);
    showConnectionScreen(targetDevice.name);
    
    createPeerConnection(targetId);
    
    // Create data channels
    controlChannel = peerConnection.createDataChannel('control');
    setupControlChannel(controlChannel);
    
    fileChannel = peerConnection.createDataChannel('file', { ordered: true });
    setupFileChannel(fileChannel);
    
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        socket.send(JSON.stringify({
            type: 'OFFER',
            senderId: myDeviceId,
            targetId: targetId,
            data: offer
        }));
    } catch (e) {
        console.error('Error creating offer:', e);
    }
}

async function handleOffer(msg) {
    if (peerConnection) {
        console.warn('Already connecting or connected, ignoring offer');
        return;
    }
    
    currentPeerId = msg.senderId;
    const senderDevice = devices.get(msg.senderId);
    const senderName = senderDevice ? senderDevice.name : 'Unknown Device';
    showConnectionScreen(senderName);
    
    createPeerConnection(msg.senderId);
    
    peerConnection.ondatachannel = (event) => {
        if (event.channel.label === 'control') {
            controlChannel = event.channel;
            setupControlChannel(controlChannel);
        } else if (event.channel.label === 'file') {
            fileChannel = event.channel;
            setupFileChannel(fileChannel);
        }
    };
    
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        socket.send(JSON.stringify({
            type: 'ANSWER',
            senderId: myDeviceId,
            targetId: msg.senderId,
            data: answer
        }));
    } catch (e) {
        console.error('Error handling offer:', e);
    }
}

async function handleAnswer(msg) {
    if (!peerConnection) return;
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.data));
    } catch (e) {
        console.error('Error handling answer:', e);
    }
}

async function handleIceCandidate(msg) {
    if (!peerConnection) return;
    try {
        if (msg.data) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(msg.data));
        }
    } catch (e) {
        console.error('Error adding ICE candidate:', e);
    }
}

function createPeerConnection(targetId) {
    peerConnection = new RTCPeerConnection(rtcConfig);
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.send(JSON.stringify({
                type: 'ICE_CANDIDATE',
                senderId: myDeviceId,
                targetId: targetId,
                data: event.candidate
            }));
        }
    };
    
    peerConnection.onconnectionstatechange = () => {
        document.getElementById('connType').textContent = peerConnection.connectionState;
        
        if (peerConnection.connectionState === 'connected') {
            document.getElementById('connType').innerHTML = '✓ Direct P2P';
            document.getElementById('connType').style.color = 'var(--success)';
            startRTTMeasurement();
            checkConnectionType();
        } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            disconnectPeer();
            showMainScreen();
        }
    };
}

function setupControlChannel(channel) {
    channel.onopen = () => console.log('Control channel opened');
    channel.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'PONG') {
            const rtt = Date.now() - msg.timestamp;
            document.getElementById('rttValue').textContent = `${rtt} ms`;
        } else if (msg.type === 'PING') {
            controlChannel.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
        }
    };
    channel.onclose = () => console.log('Control channel closed');
}

function setupFileChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => console.log('File channel opened');
    channel.onmessage = (event) => {
        // Future: Handle binary file chunks
        console.log('Received file data:', event.data.byteLength, 'bytes');
    };
    channel.onclose = () => console.log('File channel closed');
}

function disconnectPeer() {
    if (rttInterval) clearInterval(rttInterval);
    if (controlChannel) controlChannel.close();
    if (fileChannel) fileChannel.close();
    if (peerConnection) {
        peerConnection.close();
    }
    peerConnection = null;
    controlChannel = null;
    fileChannel = null;
    currentPeerId = null;
}

// ----------------------------------------------------
// STATS & DIAGNOSTICS
// ----------------------------------------------------

function startRTTMeasurement() {
    if (rttInterval) clearInterval(rttInterval);
    rttInterval = setInterval(() => {
        if (controlChannel && controlChannel.readyState === 'open') {
            controlChannel.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
        }
    }, 2000);
}

async function checkConnectionType() {
    if (!peerConnection) return;
    const stats = await peerConnection.getStats();
    let networkType = 'Unknown';
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const local = stats.get(report.localCandidateId);
            const remote = stats.get(report.remoteCandidateId);
            
            if (local && remote) {
                if (local.candidateType === 'host' && remote.candidateType === 'host') {
                    networkType = 'Local (LAN)';
                } else if (local.candidateType === 'srflx' || remote.candidateType === 'srflx') {
                    networkType = 'Public (Internet)';
                } else if (local.candidateType === 'relay' || remote.candidateType === 'relay') {
                    networkType = 'Relay (TURN)';
                }
            }
        }
    });
    
    document.getElementById('networkType').textContent = networkType;
}

// ----------------------------------------------------
// UI LOGIC
// ----------------------------------------------------

function updateStatus(text, className) {
    const indicator = document.getElementById('statusIndicator');
    const textEl = document.getElementById('statusText');
    
    indicator.className = 'status-indicator';
    if (className) indicator.classList.add(className);
    
    textEl.textContent = text;
}

function renderDevices() {
    const listEl = document.getElementById('deviceList');
    listEl.innerHTML = '';
    
    if (devices.size === 0) {
        listEl.innerHTML = `<div class="empty-state">No nearby devices found. Waiting...</div>`;
        return;
    }
    
    devices.forEach((device) => {
        const card = document.createElement('div');
        card.className = 'device-card';
        card.onclick = () => initiateConnection(device.id);
        card.innerHTML = `
            <div class="device-icon">💻</div>
            <div class="device-info">
                <h3>${escapeHtml(device.name)}</h3>
                <p>Click to connect</p>
            </div>
        `;
        listEl.appendChild(card);
    });
}

function showConnectionScreen(peerName) {
    document.getElementById('mainScreen').style.display = 'none';
    document.getElementById('connectionScreen').style.display = 'block';
    document.getElementById('connectionTitle').textContent = `Connecting to ${escapeHtml(peerName)}...`;
    
    document.getElementById('connType').textContent = 'Connecting...';
    document.getElementById('connType').style.color = 'var(--text-main)';
    document.getElementById('networkType').textContent = '-';
    document.getElementById('rttValue').textContent = '- ms';
}

function showMainScreen() {
    document.getElementById('connectionScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display = 'block';
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
