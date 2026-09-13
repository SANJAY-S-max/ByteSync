package com.bytesync.signaling;

import org.springframework.web.socket.WebSocketSession;
import java.util.Map;

public class Device {
    private final String id;
    private final String name;
    private final String platform;
    private final Map<?, ?> coords;
    private final WebSocketSession session;

    public Device(String id, String name, String platform, Map<?, ?> coords, WebSocketSession session) {
        this.id = id;
        this.name = name;
        this.platform = platform;
        this.coords = coords;
        this.session = session;
    }

    public String getId() { return id; }
    public String getName() { return name; }
    public String getPlatform() { return platform; }
    public Map<?, ?> getCoords() { return coords; }
    public WebSocketSession getSession() { return session; }
}
