// ByteSync WebRTC Logic
const PROTOCOL_VERSION = 1;
const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256 KB initial chunk size

function generateId() {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

function generateDeviceName() {
    const adjectives = ['Quantum', 'Neon', 'Cosmic', 'Hyper', 'Sonic', 'Cyber', 'Stellar', 'Ghost', 'Phantom', 'Midnight'];
    const nouns = ['Falcon', 'Panther', 'Wolf', 'Dragon', 'Phoenix', 'Ninja', 'Rider', 'Voyager', 'Nomad', 'Sphinx'];
    return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${nouns[Math.floor(Math.random() * nouns.length)]}`;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const myDeviceId = generateId();
const myDeviceName = generateDeviceName();

let myPlatform = 'desktop';
let myCoords = null;

function detectDevicePlatform() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iPad/.test(ua)) return 'tablet';
    if (/iPhone|iPod/.test(ua)) return 'ios';
    if (/windows phone/i.test(ua)) return 'windows';
    if (/Macintosh/.test(ua)) return 'mac';
    if (/Windows/.test(ua)) return 'windows';
    if (/Linux/.test(ua)) return 'linux';
    return 'desktop';
}

function getPlatformIcon(platform) {
    switch (platform) {
        case 'android': return 'fa-brands fa-android';
        case 'ios':     return 'fa-brands fa-apple';
        case 'tablet':  return 'fa-solid fa-tablet-screen-button';
        case 'mac':     return 'fa-brands fa-apple';
        case 'windows': return 'fa-brands fa-windows';
        case 'linux':   return 'fa-brands fa-linux';
        default:        return 'fa-solid fa-laptop';
    }
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371e3; // metres
    const f1 = lat1 * Math.PI / 180;
    const f2 = lat2 * Math.PI / 180;
    const df = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(df / 2) * Math.sin(df / 2) +
              Math.cos(f1) * Math.cos(f2) *
              Math.sin(dl / 2) * Math.sin(dl / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
}

myPlatform = detectDevicePlatform();

if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            myCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: 'JOIN',
                    senderId: myDeviceId,
                    data: { name: myDeviceName, platform: myPlatform, coords: myCoords }
                }));
            }
        },
        (err) => console.warn('Geolocation denied:', err),
        { timeout: 5000 }
    );
}

let socket = null;
const devices = new Map();

// WebRTC State
let peerConnection = null;
let controlChannel = null;
let fileChannel = null;
let currentPeerId = null;
let rttInterval = null;

// Transfer State
let fileToSend = null;
let currentTransferMeta = null;
let receivedChunks = []; // Fallback if no File System Access API
let receivedBytes = 0;
let transferStartTime = 0;

let hashWorker = null;
let fileHash = '';
let senderHash = null;
let receiverHash = null;

const pausedTransfers = new Map(); // peerId -> { meta, file, receivedBytes, receivedChunks, fileHandle, senderHash, receiverHash }

function initHashWorker() {
    if (!hashWorker) {
        hashWorker = new Worker('/workers/hash-worker.js');
        hashWorker.onmessage = (e) => {
            if (e.data.type === 'hash_result') {
                fileHash = e.data.hash;
                console.log('Calculated Hash:', fileHash);
                
                if (fileToSend) {
                    if (controlChannel && controlChannel.readyState === 'open') {
                        controlChannel.send(JSON.stringify({
                            type: 'FILE_HASH',
                            data: { hash: fileHash }
                        }));
                    }
                    document.getElementById('transferSpeed').innerHTML = `✓ Complete <br> <span style="color:var(--success)">SHA-256: ${fileHash.substring(0,8)}...</span>`;
                } else {
                    receiverHash = fileHash;
                    verifyHash();
                }
            }
        };
    }
    hashWorker.postMessage({ type: 'init' });
}

function verifyHash() {
    if (!fileToSend && senderHash && receiverHash) {
        if (senderHash === receiverHash) {
            document.getElementById('transferSpeed').innerHTML = `✓ Saved <br> <span style="color:var(--success)">✓ Verified (SHA-256 Match: ${receiverHash.substring(0,8)}...)</span>`;
        } else {
            document.getElementById('transferSpeed').innerHTML = `✓ Saved <br> <span style="color:var(--danger)">✗ Corrupted (SHA-256 Mismatch)</span>`;
        }
    }
}

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('myDeviceName').textContent = myDeviceName;
    const centerIcon = document.querySelector('#myDeviceNode i');
    if (centerIcon) {
        centerIcon.className = getPlatformIcon(myPlatform);
    }
    
    // UI Event Listeners
    document.getElementById('disconnectBtn').addEventListener('click', () => {
        disconnectPeer();
        showScreen('mainScreen');
    });

    document.getElementById('selectFileBtn').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });

    document.getElementById('fileInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelected(e.target.files[0]);
        }
    });

    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelected(e.dataTransfer.files[0]);
        }
    });

    document.getElementById('acceptFileBtn').addEventListener('click', acceptFile);
    document.getElementById('rejectFileBtn').addEventListener('click', rejectFile);
    document.getElementById('cancelTransferBtn').addEventListener('click', () => {
        handleConnectionDrop();
    });

    connectWebSocket();
});

// ----------------------------------------------------
// SIGNALING & DISCOVERY
// ----------------------------------------------------

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
            data: { name: myDeviceName, platform: myPlatform, coords: myCoords }
        }));
    };
    
    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleSignalingMessage(msg);
    };
    
    let reconnectTimeout = null;
    socket.onclose = () => {
        console.log('Disconnected from signaling server');
        updateStatus('Reconnecting...', '');
        
        if (!reconnectTimeout) {
            reconnectTimeout = setTimeout(() => {
                reconnectTimeout = null;
                connectWebSocket();
            }, 3000);
        }
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
                showScreen('mainScreen');
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
    showConnectionScreen(targetDevice ? targetDevice.name : 'Unknown Device');
    
    createPeerConnection(targetId);
    
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
    if (peerConnection) return;
    
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
        const state = peerConnection.connectionState;
        document.getElementById('connType').textContent = state;

        if (state === 'connected') {
            document.getElementById('connType').innerHTML = '✓ Direct P2P';
            document.getElementById('connType').style.color = 'var(--success)';
            document.getElementById('fileTransferSection').style.display = 'block';
            startRTTMeasurement();
            checkConnectionType();
            initChatUI();

            // Check if we need to resume
            if (pausedTransfers.has(currentPeerId)) {
                const saved = pausedTransfers.get(currentPeerId);
                if (saved.isSender) {
                    controlChannel.send(JSON.stringify({
                        type: 'FILE_RESUME_OFFER',
                        data: { transferId: saved.meta.transferId }
                    }));
                }
            }
        } else if (state === 'connecting') {
            document.getElementById('connType').textContent = '⟳ Connecting…';
            document.getElementById('connType').style.color = 'var(--text-muted)';
        } else if (state === 'disconnected' || state === 'failed') {
            handleConnectionDrop();
        }
    };
}

function handleConnectionDrop() {
    if (currentTransferMeta) {
        document.getElementById('transferTitle').textContent = 'Transfer Interrupted';
        document.getElementById('transferTitle').style.color = 'var(--danger)';
        document.getElementById('transferSpeed').textContent = 'Connection lost. Saved state for resume.';
        document.getElementById('transferSpeed').style.color = 'var(--danger)';
        
        pausedTransfers.set(currentPeerId, {
            meta: currentTransferMeta,
            file: fileToSend,
            receivedBytes: receivedBytes,
            receivedChunks: receivedChunks,
            fileHandle: currentTransferMeta.fileHandle,
            senderHash: senderHash,
            receiverHash: receiverHash,
            isSender: !!fileToSend
        });
        
        setTimeout(() => {
            disconnectPeer();
            showScreen('mainScreen');
            document.getElementById('transferTitle').style.color = '';
            document.getElementById('transferSpeed').style.color = '';
        }, 3000);
    } else {
        disconnectPeer();
        showScreen('mainScreen');
    }
}

function setupControlChannel(channel) {
    channel.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleControlMessage(msg);
    };
}

function setupFileChannel(channel) {
    channel.binaryType = 'arraybuffer';
    channel.bufferedAmountLowThreshold = 1024 * 1024; // 1 MB
    channel.onmessage = async (event) => {
        if (!currentTransferMeta) return;
        
        // Hash it incrementally
        if (hashWorker) {
            const workerChunk = event.data.slice(0);
            hashWorker.postMessage({ type: 'update', chunk: workerChunk }, [workerChunk]);
        }
        
        if (currentTransferMeta.writableStream) {
            await currentTransferMeta.writableStream.write(event.data);
        } else {
            receivedChunks.push(event.data);
        }
        
        receivedBytes += event.data.byteLength;
        
        updateTransferProgress(receivedBytes, currentTransferMeta.size);
    };
}

// ----------------------------------------------------
// FILE TRANSFER LOGIC
// ----------------------------------------------------

function handleControlMessage(msg) {
    switch (msg.type) {
        case 'PING':
            controlChannel.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
            break;
        case 'PONG': {
            const rtt = Date.now() - msg.timestamp;
            document.getElementById('rttValue').textContent = `${rtt} ms`;
            break;
        }
        case 'FILE_OFFER':
            handleFileOffer(msg.data);
            break;
        case 'FILE_ACCEPT':
            startSendingFile();
            break;
        case 'FILE_REJECT':
            alert('File transfer was rejected by the peer.');
            showScreen('connectionScreen');
            break;
        case 'TRANSFER_COMPLETE':
            finishReceivingFile();
            break;
        case 'FILE_RESUME_OFFER':
            handleFileResumeOffer(msg.data);
            break;
        case 'FILE_RESUME_ACCEPT':
            resumeSendingFile(msg.data.offset);
            break;
        case 'FILE_HASH':
            senderHash = msg.data.hash;
            verifyHash();
            break;
        case 'CHAT':
            appendChatMessage(msg.text, false);
            break;
    }
}

function handleFileSelected(file) {
    fileToSend = file;
    const totalChunks = Math.ceil(file.size / DEFAULT_CHUNK_SIZE);
    
    const meta = {
        protocolVersion: PROTOCOL_VERSION,
        transferId: generateId(),
        name: file.name,
        size: file.size,
        mimeType: file.type,
        chunkSize: DEFAULT_CHUNK_SIZE,
        totalChunks: totalChunks
    };

    showScreen('transferScreen');
    document.getElementById('transferTitle').textContent = 'Waiting for acceptance…';
    document.getElementById('transferFileName').textContent = file.name;
    updateTransferProgress(0, file.size);
    
    controlChannel.send(JSON.stringify({ type: 'FILE_OFFER', data: meta }));
    
    // Reset file input so same file can be selected again
    document.getElementById('fileInput').value = '';
}

function handleFileOffer(meta) {
    currentTransferMeta = meta;
    receivedChunks = [];
    receivedBytes = 0;
    senderHash = null;
    receiverHash = null;
    
    showScreen('receiveScreen');
    document.getElementById('receiveFileName').textContent = meta.name;
    document.getElementById('receiveFileSize').textContent = formatBytes(meta.size);
    const peerName = devices.has(currentPeerId) ? devices.get(currentPeerId).name : 'Peer';
    document.getElementById('receiveSenderName').textContent = peerName;
}

async function acceptFile() {
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: currentTransferMeta.name
            });
            currentTransferMeta.fileHandle = handle;
            currentTransferMeta.writableStream = await handle.createWritable();
        } catch (e) {
            console.log('User cancelled save dialog or it failed:', e);
            rejectFile();
            return;
        }
    } else {
        console.warn('File System Access API not supported. Falling back to RAM buffering.');
    }

    initHashWorker();

    showScreen('transferScreen');
    document.getElementById('transferTitle').textContent = 'Receiving…';
    document.getElementById('transferFileName').textContent = currentTransferMeta.name;
    updateTransferProgress(0, currentTransferMeta.size);
    transferStartTime = Date.now();
    controlChannel.send(JSON.stringify({ type: 'FILE_ACCEPT' }));
}

function rejectFile() {
    controlChannel.send(JSON.stringify({ type: 'FILE_REJECT' }));
    showScreen('connectionScreen');
}

async function startSendingFile() {
    document.getElementById('transferTitle').textContent = 'Sending…';
    startSendingFileLoop(0);
}

async function startSendingFileLoop(startOffset) {
    transferStartTime = Date.now();
    
    initHashWorker();

    const size = fileToSend.size;
    let offset = startOffset;

    const readSlice = (o, length) => {
        return new Promise((resolve, reject) => {
            const slice = fileToSend.slice(o, o + length);
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(slice);
        });
    };

    while (offset < size) {
        if (fileChannel.readyState !== 'open') {
            console.error('File channel closed during transfer');
            handleConnectionDrop();
            break;
        }

        // Backpressure check - limit buffered amount to 4MB
        if (fileChannel.bufferedAmount > 4 * 1024 * 1024) {
            document.getElementById('transferSpeed').textContent = 'Pacing transfer (network congested)…';
            await new Promise(resolve => {
                fileChannel.onbufferedamountlow = () => {
                    fileChannel.onbufferedamountlow = null;
                    resolve();
                };
            });
        }

        const chunkLen = Math.min(DEFAULT_CHUNK_SIZE, size - offset);
        const buffer = await readSlice(offset, chunkLen);
        
        // Hash it incrementally
        if (hashWorker) {
            const workerChunk = buffer.slice(0);
            hashWorker.postMessage({ type: 'update', chunk: workerChunk }, [workerChunk]);
        }
        
        fileChannel.send(buffer);
        offset += chunkLen;
        
        updateTransferProgress(offset, size);
    }
    
    if (hashWorker) {
        hashWorker.postMessage({ type: 'finalize' });
    }
    
    controlChannel.send(JSON.stringify({ type: 'TRANSFER_COMPLETE' }));
    pausedTransfers.delete(currentPeerId);
    
    setTimeout(() => {
        document.getElementById('transferTitle').textContent = 'Transfer Complete!';
        document.getElementById('transferSpeed').textContent = '✓ Done';
        setTimeout(() => showScreen('connectionScreen'), 3000);
    }, 500);
}

async function finishReceivingFile() {
    if (currentTransferMeta.writableStream) {
        await currentTransferMeta.writableStream.close();
        document.getElementById('transferSpeed').innerHTML = '✓ Saved to disk. Verifying…';
    } else {
        const blob = new Blob(receivedChunks, { type: currentTransferMeta.mimeType });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = currentTransferMeta.name;
        a.click();
        
        URL.revokeObjectURL(url);
        document.getElementById('transferSpeed').innerHTML = '✓ Download triggered. Verifying…';
    }
    
    if (hashWorker) {
        hashWorker.postMessage({ type: 'finalize' });
    }
    
    document.getElementById('transferTitle').textContent = 'Transfer Complete!';
    
    setTimeout(() => {
        showScreen('connectionScreen');
        currentTransferMeta = null;
        receivedChunks = [];
        senderHash = null;
        receiverHash = null;
    }, 7000);
}

// RESUME PROTOCOL
async function handleFileResumeOffer(data) {
    if (pausedTransfers.has(currentPeerId)) {
        const state = pausedTransfers.get(currentPeerId);
        if (state.meta.transferId === data.transferId && !state.isSender) {
            
            currentTransferMeta = state.meta;
            receivedBytes = state.receivedBytes;
            receivedChunks = state.receivedChunks || [];
            senderHash = state.senderHash;
            receiverHash = state.receiverHash;
            
            if (state.fileHandle) {
                currentTransferMeta.fileHandle = state.fileHandle;
                currentTransferMeta.writableStream = await state.fileHandle.createWritable({ keepExistingData: true });
                await currentTransferMeta.writableStream.seek(receivedBytes);
            }
            
            showScreen('transferScreen');
            document.getElementById('transferTitle').textContent = 'Resuming Reception…';
            document.getElementById('transferFileName').textContent = currentTransferMeta.name;
            updateTransferProgress(receivedBytes, currentTransferMeta.size);
            
            initHashWorker();
            
            controlChannel.send(JSON.stringify({
                type: 'FILE_RESUME_ACCEPT',
                data: { offset: receivedBytes }
            }));
            
            pausedTransfers.delete(currentPeerId);
        }
    }
}

async function resumeSendingFile(offset) {
    if (!pausedTransfers.has(currentPeerId)) return;
    const state = pausedTransfers.get(currentPeerId);
    
    fileToSend = state.file;
    currentTransferMeta = state.meta;
    
    showScreen('transferScreen');
    document.getElementById('transferTitle').textContent = 'Resuming Transmission…';
    document.getElementById('transferFileName').textContent = currentTransferMeta.name;
    
    pausedTransfers.delete(currentPeerId);
    
    startSendingFileLoop(offset);
}

function updateTransferProgress(current, total) {
    document.getElementById('transferProgressText').textContent = `${formatBytes(current)} / ${formatBytes(total)}`;
    const percent = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('transferProgressBar').style.width = `${percent}%`;
    
    const elapsed = (Date.now() - transferStartTime) / 1000;
    if (elapsed > 0.5 && current > 0) {
        const speed = current / elapsed;
        document.getElementById('transferSpeed').textContent = `${formatBytes(speed)}/s`;
    }
}

function disconnectPeer() {
    if (rttInterval) clearInterval(rttInterval);
    if (controlChannel) controlChannel.close();
    if (fileChannel) fileChannel.close();
    if (peerConnection) peerConnection.close();
    
    peerConnection = null;
    controlChannel = null;
    fileChannel = null;
    currentPeerId = null;
    fileToSend = null;
    currentTransferMeta = null;
    
    document.getElementById('fileTransferSection').style.display = 'none';
    document.getElementById('connType').style.color = '';
}

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

function updateStatus(text, className) {
    const indicator = document.getElementById('statusIndicator');
    document.getElementById('statusText').textContent = text;
    indicator.className = 'status-indicator';
    if (className) indicator.classList.add(className);
}

// -------------------------------------------------------
// SCREEN NAVIGATION
// -------------------------------------------------------

/**
 * Shows a named screen and hides all others.
 */
function showScreen(screenId) {
    ['mainScreen', 'connectionScreen', 'transferScreen', 'receiveScreen'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === screenId) ? 'block' : 'none';
    });
}

/**
 * Navigates to the connectionScreen and sets the peer name in the title.
 */
function showConnectionScreen(peerName) {
    showScreen('connectionScreen');
    const titleEl = document.getElementById('connectionTitle');
    if (titleEl) titleEl.textContent = `Connected to ${peerName}`;
    // Reset connection stats
    document.getElementById('connType').textContent = '⟳ Connecting…';
    document.getElementById('connType').style.color = 'var(--text-muted)';
    document.getElementById('networkType').textContent = '-';
    document.getElementById('rttValue').textContent = '- ms';
}

// -------------------------------------------------------
// RADAR RENDERING
// -------------------------------------------------------

function renderDevices() {
    const radarContainer = document.getElementById('radarContainer');
    if (!radarContainer) return;
    
    // Remove existing device nodes (keep center and scan)
    radarContainer.querySelectorAll('.radar-node').forEach(n => n.remove());
    
    if (devices.size === 0) return;
    
    // Use the actual rendered size of the radar container
    const radarWrapper = document.querySelector('.radar-wrapper');
    const size = radarWrapper ? radarWrapper.offsetWidth : 300;
    const center = size / 2;
    const radius = size * 0.38; // 38% of total size keeps nodes inside the circle
    
    const angleStep = (2 * Math.PI) / devices.size;
    let angle = -Math.PI / 2; // Start from top (12 o'clock)
    
    devices.forEach((device) => {
        let distText = '';
        if (myCoords && device.coords) {
            const dist = calculateDistance(myCoords.lat, myCoords.lon, device.coords.lat, device.coords.lon);
            if (dist !== null) {
                distText = dist < 1000 ? `${dist}m away` : `${(dist / 1000).toFixed(1)}km`;
            }
        }
        
        const platformIcon = getPlatformIcon(device.platform);
        
        const node = document.createElement('div');
        node.className = 'radar-node';
        node.setAttribute('data-id', device.id);
        node.setAttribute('title', device.name);
        
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        
        node.onclick = () => initiateConnection(device.id);
        
        node.innerHTML = `
            <i class="${platformIcon}"></i>
            <div class="radar-node-info">
                <strong>${escapeHtml(device.name)}</strong>
                ${distText ? `<span>${distText}</span>` : ''}
            </div>
        `;
        
        radarContainer.appendChild(node);
        angle += angleStep;
    });
}

// Re-render on window resize so node positions stay correct on mobile
window.addEventListener('resize', renderDevices);

// -------------------------------------------------------
// CHAT
// -------------------------------------------------------

function initChatUI() {
    const chatSendBtn = document.getElementById('chatSendBtn');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    
    if (chatMessages) chatMessages.innerHTML = '<div class="chat-system-msg">Chat enabled via WebRTC.</div>';
    
    // Re-assign to avoid duplicate listeners (clone trick)
    const newBtn = chatSendBtn.cloneNode(true);
    chatSendBtn.parentNode.replaceChild(newBtn, chatSendBtn);
    const newInput = chatInput.cloneNode(true);
    chatInput.parentNode.replaceChild(newInput, chatInput);
    
    newBtn.onclick = () => sendChatMessage();
    newInput.onkeypress = (e) => {
        if (e.key === 'Enter') sendChatMessage();
    };
}

function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (text && controlChannel && controlChannel.readyState === 'open') {
        controlChannel.send(JSON.stringify({ type: 'CHAT', text: text }));
        appendChatMessage(text, true);
        input.value = '';
    }
}

function appendChatMessage(text, isSelf) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${isSelf ? 'self' : 'peer'}`;
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// -------------------------------------------------------
// UTILITY
// -------------------------------------------------------

function escapeHtml(unsafe) {
    return unsafe.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[m]);
}
