# ByteSync

Ultra-fast direct peer-to-peer file sharing.

## What is ByteSync?
ByteSync is a local and internet P2P file transfer application that allows two devices to directly connect and share files of any size over a WebRTC connection.

It is designed to be:
- **Fast**: Direct P2P transfer minimizes overhead and maximizes throughput.
- **Direct**: Uses WebRTC data channels for browser-to-browser communication.
- **Private**: No file is ever uploaded to a central server.
- **Verified**: SHA-256 integrity checks ensure your file arrives uncorrupted.

## Key Features
- **No Login**: No accounts, passwords, or emails required.
- **No File Storage**: The server acts only as a signaling intermediary to coordinate the P2P connection.
- **Resumable Transfers**: Interrupted transfers can be resumed from the exact chunk where they left off.
- **Adaptive Chunking**: Optimizes the transfer size based on network conditions and device performance.
- **Backpressure**: Prevents memory overflow on large transfers, avoiding browser crashes.

## Architecture
- **Browser**: Handles the UI, file chunking, WebRTC connections, and SHA-256 verification.
- **Server**: Java Spring Boot backend for WebSocket signaling and peer discovery. 

## Local Development

### Requirements
- Java 21
- Maven
- A modern web browser

### Running the Application

1. Build the project:
   ```bash
   mvn clean package
   ```
2. Run the application:
   ```bash
   mvn spring-boot:run
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:8080
   ```

## License
MIT License
