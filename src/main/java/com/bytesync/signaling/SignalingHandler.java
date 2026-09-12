package com.bytesync.signaling;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Component
public class SignalingHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(SignalingHandler.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    // Map deviceId -> Device
    private final Map<String, Device> activeDevices = new ConcurrentHashMap<>();
    
    // Map sessionId -> deviceId for cleanup
    private final Map<String, String> sessionToDeviceMap = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        log.info("New WebSocket connection established: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        try {
            SignalingMessage signalingMessage = objectMapper.readValue(payload, SignalingMessage.class);
            String type = signalingMessage.getType();
            String senderId = signalingMessage.getSenderId();

            if ("JOIN".equals(type)) {
                handleJoin(session, senderId, signalingMessage.getData());
            } else if (signalingMessage.getTargetId() != null) {
                routeMessage(signalingMessage, payload);
            } else {
                log.warn("Received message without targetId and not a JOIN: {}", type);
            }
        } catch (Exception e) {
            log.error("Error processing signaling message: {}", e.getMessage());
        }
    }

    private void handleJoin(WebSocketSession session, String deviceId, Object data) throws IOException {
        String deviceName = "Unknown Device";
        if (data != null && data instanceof Map) {
            Map<?, ?> dataMap = (Map<?, ?>) data;
            if (dataMap.containsKey("name")) {
                deviceName = (String) dataMap.get("name");
            }
        }

        Device device = new Device(deviceId, deviceName, session);
        activeDevices.put(deviceId, device);
        sessionToDeviceMap.put(session.getId(), deviceId);

        log.info("Device joined: {} ({})", deviceName, deviceId);

        // Notify the new device about all currently active devices
        Collection<Map<String, String>> deviceList = activeDevices.values().stream()
                .filter(d -> !d.getId().equals(deviceId))
                .map(d -> Map.of("id", d.getId(), "name", d.getName()))
                .collect(Collectors.toList());

        SignalingMessage directoryMsg = new SignalingMessage("DIRECTORY", "server", deviceId, deviceList);
        session.sendMessage(new TextMessage(objectMapper.writeValueAsString(directoryMsg)));

        // Broadcast to all other devices that a new device joined
        SignalingMessage peerJoinedMsg = new SignalingMessage("PEER_JOINED", "server", null, Map.of("id", deviceId, "name", deviceName));
        broadcast(peerJoinedMsg, deviceId);
    }

    private void routeMessage(SignalingMessage message, String rawPayload) throws IOException {
        Device targetDevice = activeDevices.get(message.getTargetId());
        if (targetDevice != null && targetDevice.getSession().isOpen()) {
            log.debug("Routing {} from {} to {}", message.getType(), message.getSenderId(), message.getTargetId());
            targetDevice.getSession().sendMessage(new TextMessage(rawPayload));
        } else {
            log.warn("Target device {} not found or session closed.", message.getTargetId());
        }
    }

    private void broadcast(SignalingMessage message, String excludeDeviceId) throws IOException {
        String payload = objectMapper.writeValueAsString(message);
        TextMessage textMessage = new TextMessage(payload);

        for (Device device : activeDevices.values()) {
            if (!device.getId().equals(excludeDeviceId) && device.getSession().isOpen()) {
                device.getSession().sendMessage(textMessage);
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String deviceId = sessionToDeviceMap.remove(session.getId());
        if (deviceId != null) {
            Device removedDevice = activeDevices.remove(deviceId);
            if (removedDevice != null) {
                log.info("Device disconnected: {} ({})", removedDevice.getName(), deviceId);
                // Broadcast PEER_LEFT
                SignalingMessage peerLeftMsg = new SignalingMessage("PEER_LEFT", "server", null, Map.of("id", deviceId));
                broadcast(peerLeftMsg, null);
            }
        }
        log.info("WebSocket connection closed: {}", session.getId());
    }
}
