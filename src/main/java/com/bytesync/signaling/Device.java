package com.bytesync.signaling;

import org.springframework.web.socket.WebSocketSession;

public class Device {
    private final String id;
    private final String name;
    private final WebSocketSession session;

    public Device(String id, String name, WebSocketSession session) {
        this.id = id;
        this.name = name;
        this.session = session;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public WebSocketSession getSession() { return session; }
}
