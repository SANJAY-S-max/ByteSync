# ByteSync

> **Fast. Direct. Private.** — Browser-based P2P file sharing with radar device discovery, real-time chat, and SHA-256 integrity verification.

---

## What is ByteSync?

ByteSync is a zero-install, zero-login, browser-native peer-to-peer file transfer application. Two devices open the app in any modern browser, discover each other on an animated radar, connect directly via WebRTC, and transfer files of any size — without a single byte touching a cloud server.

---

## ✨ Unique Features

### 🎯 Animated Radar Device Discovery
Devices on the same signaling server appear as live nodes on an animated radar screen — complete with a rotating sweep line and pulsing center ping. Devices are plotted at cardinal positions around the radar circle using trigonometry, and hovering over a node reveals the device name and real-time distance.

### 📡 Real-time Distance Between Devices
If the user grants location permission, ByteSync broadcasts GPS coordinates via the WebSocket JOIN handshake. The Haversine formula then computes the great-circle distance between devices and displays it under each radar node (e.g. *"342m away"* or *"1.4km"*).

### 🖥️ Smart Platform Detection & Device Icons
ByteSync inspects `navigator.userAgent` to identify the peer's platform and renders the matching icon on the radar:

| Platform | Icon |
|---|---|
| iPhone / iPod | Apple  |
| iPad | Tablet |
| Android | Android |
| Windows PC | Windows |
| macOS | Apple |
| Linux | Linux Penguin |
| Other | Laptop |

The server relays `platform` and `coords` fields alongside every `JOIN`, `DIRECTORY`, and `PEER_JOINED` message, so icon and distance data reach all connected peers correctly.

### 💬 Real-time WebRTC Chat
Once a WebRTC connection is established, a chat panel appears below the connection screen. Messages travel directly peer-to-peer over the same `controlChannel` data channel used for transfer signalling — no server relay, no latency. Press **Enter** or the send button to transmit instantly.

### 🔐 SHA-256 Integrity Verification
Every transferred file is hashed chunk-by-chunk in a dedicated Web Worker (non-blocking). When the transfer completes, the sender transmits its computed hash over the control channel and the receiver independently calculates its own. A match/mismatch result is displayed prominently so you always know your file arrived intact.

### ⚡ Resumable Transfers
If the WebRTC connection drops mid-transfer, ByteSync saves the transfer state (bytes received, file handle, partial hash). When the peer reconnects, a `FILE_RESUME_OFFER` / `FILE_RESUME_ACCEPT` handshake lets both sides pick up from the exact byte offset — no re-sending from scratch.

### 🌊 Backpressure & Adaptive Pacing
The file sender monitors `fileChannel.bufferedAmount` and pauses transmission when the buffer exceeds 4 MB, resuming only when the `bufferedamountlow` event fires. This prevents browser memory exhaustion on multi-gigabyte files.

### 📱 Fully Responsive Mobile UI
Every size is fluid:
- Radar: `min(85vw, 300px)` — fits any phone screen
- Container padding: `clamp(1.25rem, 5vw, 2.5rem)`
- All typography: `clamp()` fluid scaling
- Dedicated media queries for `≤400px`, `401–600px`, `≤480px`

### 🎨 Custom Circular SVG Favicon
A hand-crafted SVG favicon featuring a glowing blue/green sync arc logo on a deep navy circular disc — crisp at all sizes, perfectly circular in the browser tab. Modern browsers use the SVG; legacy browsers fall back to `.ico`.

---

## Architecture

```
Browser A                    Spring Boot Server              Browser B
─────────────────────        ──────────────────────          ─────────────────────
WebSocket ──JOIN──────────▶  SignalingHandler                ◀──JOIN────── WebSocket
          ◀─DIRECTORY──────  (routes signals only)  ──────▶
          ──OFFER──────────▶                         ──────▶
          ◀─────────────────                         ◀─ANSWER──
          ──ICE_CANDIDATE──▶                         ──────▶
          ◀─────────────────                         ◀─ICE──────
                                                  
WebRTC DataChannel ◀──────── Direct P2P (no server) ────────▶ WebRTC DataChannel
  controlChannel  (PING/PONG, FILE_OFFER, FILE_ACCEPT,        controlChannel
  fileChannel      FILE_HASH, CHAT, RESUME_*)                  fileChannel
```

- **Frontend**: Vanilla JS + CSS — no frameworks, no bundler
- **Backend**: Java 17 + Spring Boot 3 + Spring WebSocket
- **Signaling**: WebSocket (`/signal`) — routes OFFER/ANSWER/ICE only; never touches file data
- **Transfer**: WebRTC `RTCDataChannel` with binary `arraybuffer` mode

---

## Key Technical Specs

| Spec | Value |
|---|---|
| Protocol | WebRTC (DTLS-SRTP secured) |
| Chunk size | 256 KB (adaptive with backpressure) |
| Hash algorithm | SHA-256 (incremental, Web Worker) |
| Max tested file size | 1 GB |
| Avg. LAN speed | 250 MB/s |
| Peak LAN speed | 310 MB/s |
| STUN servers | Google STUN (×2) |
| Signaling | WebSocket (Spring Boot) |

---

## Getting Started

### Requirements
- Java 17+
- Maven (or use the included `mvnw` wrapper)
- A modern browser (Chrome 90+, Firefox 88+, Edge 90+, Safari 15+)

### Run Locally

```bash
# Clone the repo
git clone https://github.com/your-username/ByteSync.git
cd ByteSync

# Start the server (Maven wrapper included)
./mvnw spring-boot:run        # macOS / Linux
mvnw.cmd spring-boot:run      # Windows

# Open in browser
http://localhost:8080
```

### Test a Transfer
1. Open **two browser tabs** at `http://localhost:8080`
2. Each tab gets a unique randomized name (e.g. *"Quantum Falcon"*)
3. They appear on each other's **radar** — click the peer node to connect
4. Wait ~1 second for WebRTC to establish → status shows **✓ Direct P2P**
5. Click **Select File to Send** → choose any file
6. The other tab shows an **incoming file** prompt → click **Accept**
7. Watch the live progress bar and MB/s speed counter
8. On completion: SHA-256 hash match is verified and displayed

---

## Project Structure

```
src/
├── main/
│   ├── java/com/bytesync/
│   │   ├── ByteSyncApplication.java
│   │   └── signaling/
│   │       ├── Device.java              # Stores id, name, platform, coords, session
│   │       ├── SignalingConfig.java     # WebSocket endpoint config (/signal)
│   │       ├── SignalingHandler.java    # Routes JOIN, OFFER, ANSWER, ICE, PEER_LEFT
│   │       └── SignalingMessage.java    # Message DTO
│   └── resources/
│       └── static/
│           ├── index.html              # Single-page app shell
│           ├── favicon.svg             # Circular SVG favicon
│           ├── favicon.ico             # Legacy ICO fallback
│           ├── css/styles.css          # Responsive styles, radar, chat
│           ├── js/app.js               # All WebRTC + UI logic
│           └── workers/hash-worker.js  # SHA-256 Web Worker
```

---

## License
MIT License — see [LICENSE](LICENSE) for details.
