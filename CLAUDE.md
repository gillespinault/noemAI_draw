# NoemAI Draw - Claude Context

## Deployment Method

**IMPORTANT**: This project deploys via **GitHub → Dokploy**, NOT local docker-compose.

### Deployment Flow
1. Make changes locally
2. Commit and push to GitHub (`git push origin main`)
3. Dokploy detects the push and auto-deploys
4. Wait for Dokploy deployment to complete before testing

### DO NOT
- Run `docker compose up` locally for production changes
- Expect local changes to take effect without git push
- Test immediately after push (wait for Dokploy rebuild ~2-3 min)

---

## Current State (v1 - December 2025)

### What Works
- **Image Injection**: Claude can inject images into collaboration rooms
- **Large files**: Up to 50MB supported (Traefik + Nginx + Express limits)
- **Encryption**: Full Excalidraw v2 format compatibility (concatBuffers)
- **WebSocket broadcast**: Correct `server-broadcast` event

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NOEMAI-DRAW STACK                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  excalidraw ───────► nginx (port 80)                        │
│      │                  │                                    │
│      │        ┌─────────┼─────────┬─────────┐               │
│      │        ↓         ↓         ↓         ↓               │
│      │    /api/v2   /socket.io  /api/inject  /*             │
│      │        │         │         │          │               │
│      │        ↓         ↓         ↓          ↓               │
│      │    storage    room    injection   frontend           │
│      │    :8080     :3002     :3003                         │
│      │        │                                              │
│      │        ↓                                              │
│      └────► redis                                            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Services
| Service | Port | Role |
|---------|------|------|
| excalidraw | 80 | Frontend + nginx proxy |
| storage | 8080 | File/scene persistence |
| room | 3002 | WebSocket collaboration |
| injection | 3003 | Image injection API |
| redis | 6379 | Data persistence |

---

## Image Injection (v1)

### Helper Script
```bash
python3 /home/gilles/serverlab/scripts/noemai-inject-image.py \
    "https://noemai-draw.robotsinlove.be/#room=ROOM_ID,ROOM_KEY" \
    /path/to/image.png \
    --x 100 --y 100
```

### Direct API Call
```bash
curl -X POST https://noemai-draw.robotsinlove.be/api/inject/inject-image \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "xxx",
    "roomKey": "xxx",
    "imageDataUrl": "data:image/png;base64,...",
    "x": 100,
    "y": 100
  }'
```

### Typical Workflow (Current)
1. User provides room URL
2. Claude generates image with Nano Banana skill
3. Claude runs injection script
4. Image appears in canvas

---

## Roadmap v2 - AI Collaboration Platform

### Vision
Transform NoemAI Draw from "injection tool" to "AI collaborator on visual canvas".

### Planned Features

#### 1. Room Registry (Redis)
- CRUD operations for rooms
- Persistent room storage with metadata
- "Active room" concept (no need to paste URL each time)

```
ROOMS:index       → ["brainstorm", "projet-alpha"]
ROOMS:brainstorm  → { roomId, roomKey, name, createdAt }
ROOMS:active      → "brainstorm"
```

#### 2. Canvas Agent (WebSocket Listener)
- Persistent connection to active room
- Receives all updates in real-time
- Maintains local state of canvas elements
- Claude can "see" what's in the canvas

#### 3. MCP Server
Tools to expose:
- `create_room(name)` → Create room, return URL
- `list_rooms()` → List existing rooms
- `set_active_room(name)` → Set current room
- `get_canvas()` → Get elements in canvas
- `inject_image(prompt, x, y)` → Generate AND inject
- `inject_element(type, props)` → Add shapes, text

#### 4. Integrated Image Generation
- Direct Gemini API call from service
- No external skill dependency
- Single action: prompt → image in canvas

### Environment Variables (v2)
```env
PORT=3003
STORAGE_BACKEND_URL=http://storage:8080
ROOM_SERVER_URL=http://room:3002
REDIS_URL=redis://redis:6379
GEMINI_API_KEY=AIzaSyDmjuw2i82QZvzFP0OZKkZuacfWPwBRcc4
```

---

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production stack definition |
| `Dockerfile.prod` | Frontend build with nginx |
| `nginx.prod.conf` | Internal routing configuration |
| `injection-service/index.js` | Image injection microservice |
| `injection-service/package.json` | Node.js dependencies |

---

## Collaboration Protocol

### Encryption
- **Algorithm**: AES-GCM 128-bit
- **Key format**: JWK base64url encoded (from URL hash)
- **IV**: 12 bytes random

### File Format (Excalidraw v2)
```
concatBuffers([
  encodingMetadata,     // {version:2, compression:"pako@1", encryption:"AES-GCM"}
  iv,                   // 12 bytes
  encrypt(deflate(concatBuffers([
    contentsMetadata,   // {mimeType, created}
    dataBuffer          // actual file bytes
  ])))
])
```

### WebSocket Events
- `join-room` → Join a collaboration room
- `server-broadcast` → Send update to other clients
- `client-broadcast` → Receive updates from server

---

## Troubleshooting

### 413 Request Entity Too Large
- Check Traefik middleware (50MB limit)
- Check nginx client_max_body_size
- Check Express body-parser limit

### Image shows grey with forbidden icon
- File format incorrect (must match Excalidraw's concatBuffers)
- Encryption key mismatch
- File not uploaded to storage

### 404 on injection endpoint
- Check nginx config includes /api/inject location
- Verify injection service is running
- Check Traefik routing

### Conflict with local stack
- Only ONE stack should run (Dokploy OR local)
- Use `docker compose -f docker-compose.prod.yml down` to stop local
- Check `docker ps | grep noemai` for duplicates
