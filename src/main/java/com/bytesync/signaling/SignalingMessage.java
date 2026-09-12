package com.bytesync.signaling;

public class SignalingMessage {
    private String type; // e.g., JOIN, LEAVE, OFFER, ANSWER, ICE_CANDIDATE, DEVICE_INFO, CONNECTION_STATUS
    private String senderId;
    private String targetId;
    private Object data;

    public SignalingMessage() {}

    public SignalingMessage(String type, String senderId, String targetId, Object data) {
        this.type = type;
        this.senderId = senderId;
        this.targetId = targetId;
        this.data = data;
    }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
    
    public String getSenderId() { return senderId; }
    public void setSenderId(String senderId) { this.senderId = senderId; }

    public String getTargetId() { return targetId; }
    public void setTargetId(String targetId) { this.targetId = targetId; }

    public Object getData() { return data; }
    public void setData(Object data) { this.data = data; }
}
