# ON-AIR Push Notifications – Delivery Options

This document describes **three supported ways** to deliver ON-AIR / OFF-AIR push notifications from the **ON-AIR Chrome Extension** (or any HTTP-capable tool such as `curl`) to family members’ devices.

All options use **simple HTTP calls**.  
The Chrome extension only needs to call a URL.

---

## Option A — ntfy (fast, free, simple)

### Topic
```
mveplus-family-in-a-meeting-onair-8f3k297
```

### ON-AIR (curl)
```bash
curl -H "Priority: 5" \
     -H "Title: 📞 ON-AIR" \
     -d "Martin is in a meeting" \
     https://ntfy.sh/mveplus-family-in-a-meeting-onair-8f3k297
```

### ON-AIR (Chrome extension – GET)
```
https://ntfy.sh/mveplus-family-in-a-meeting-onair-8f3k297/publish?title=%F0%9F%93%9E%20ON-AIR&message=Martin%20is%20in%20a%20meeting&priority=urgent
```

### OFF-AIR (curl)
```bash
curl -H "Priority: 2" \
     -H "Title: ✅ OFF-AIR" \
     -d "Meeting ended" \
     https://ntfy.sh/mveplus-family-in-a-meeting-onair-8f3k297
```

### OFF-AIR (Chrome extension – GET)
```
https://ntfy.sh/mveplus-family-in-a-meeting-onair-8f3k297/publish?title=%E2%9C%85%20OFF-AIR&message=Meeting%20ended&priority=low
```

---

## Option B — Pushover (paid, very reliable)

### Required
- APP_TOKEN
- USER_KEY (or group key)

⚠️ Pushover **requires HTTP POST**.  
For Chrome extensions that only support GET, use a tiny webhook proxy (Home Assistant, Cloudflare Worker, etc.).

### ON-AIR (curl)
```bash
curl -s \
  --form-string "token=APP_TOKEN" \
  --form-string "user=USER_KEY" \
  --form-string "priority=1" \
  --form-string "title=📞 ON-AIR" \
  --form-string "message=Martin is in a meeting" \
  https://api.pushover.net/1/messages.json
```

### OFF-AIR (curl)
```bash
curl -s \
  --form-string "token=APP_TOKEN" \
  --form-string "user=USER_KEY" \
  --form-string "priority=0" \
  --form-string "title=✅ OFF-AIR" \
  --form-string "message=Meeting ended" \
  https://api.pushover.net/1/messages.json
```

---

## Option C — Telegram Bot (free, familiar)

### Required
- BOT_TOKEN
- CHAT_ID (family group recommended)

### ON-AIR (curl)
```bash
curl -s -X POST "https://api.telegram.org/botBOT_TOKEN/sendMessage" \
  -d "chat_id=CHAT_ID" \
  --data-urlencode "text=📞 ON-AIR — Martin is in a meeting"
```

### OFF-AIR (curl)
```bash
curl -s -X POST "https://api.telegram.org/botBOT_TOKEN/sendMessage" \
  -d "chat_id=CHAT_ID" \
  --data-urlencode "text=✅ OFF-AIR — Meeting ended"
```

---

## Summary

| Option | Cost | Ease | Apple-friendly | Notes |
|------|------|------|----------------|------|
| ntfy | Free | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Best default |
| Pushover | Low | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | POST only |
| Telegram | Free | ⭐⭐⭐ | ⭐⭐⭐⭐ | Chat-based |

---

## Design principle

The ON-AIR extension performs **HTTP calls only**.  
Notification providers are **replaceable components**, ensuring long-term flexibility.
