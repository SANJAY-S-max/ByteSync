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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('myDeviceName').textContent = myDeviceName;
    connectWebSocket();
});

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // When running locally on port 8080, connect to it
    const wsUrl = `${protocol}//${window.location.host}/signal`;
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('Connected to signaling server');
        updateStatus('Ready', 'ready');
        
        // Send JOIN message
        const joinMsg = {
            type: 'JOIN',
            senderId: myDeviceId,
            data: { name: myDeviceName }
        };
        socket.send(JSON.stringify(joinMsg));
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
    
    socket.onerror = (error) => {
        console.error('WebSocket Error:', error);
    };
}

function handleSignalingMessage(msg) {
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
            break;
    }
}

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
        card.onclick = () => console.log('Selected device:', device);
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

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}
