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
- Test immediately after push (wait for Dokploy rebuild)

### To Verify Deployment
- Check Dokploy dashboard for build status
- Or ask user to confirm deployment is complete

---

## Architecture

### Services (all internal, single entry point)
- **excalidraw**: Frontend + nginx proxy (port 80, exposed via Traefik)
- **storage**: File/scene persistence (internal, port 8080)
- **room**: WebSocket collaboration server (internal, port 3002)
- **injection**: Image injection API for Claude (internal, port 3003)
- **redis**: Data persistence for storage backend

### URL Structure
- Public: `https://noemai-draw.robotsinlove.be`
- Injection API: `https://noemai-draw.robotsinlove.be/api/inject/`
- Room format: `https://noemai-draw.robotsinlove.be/#room=ROOM_ID,ROOM_KEY`

### Internal Routing (nginx)
```
/api/inject/*  → injection:3003
/api/v2/*      → storage:8080
/socket.io/*   → room:3002
/*             → excalidraw frontend
```

---

## Image Injection

### Helper Script
```bash
python3 /home/gilles/serverlab/scripts/noemai-inject-image.py \
    "https://noemai-draw.robotsinlove.be/#room=ROOM_ID,ROOM_KEY" \
    /path/to/image.png \
    --x 100 --y 100
```

### API Endpoint
```
POST /api/inject/inject-image
{
  "roomId": "xxx",
  "roomKey": "xxx",
  "imageDataUrl": "data:image/png;base64,...",
  "x": 100,
  "y": 100
}
```

### Size Limits
- Traefik: 50MB (middleware)
- Nginx: 50MB (client_max_body_size)
- Express: 50MB (body-parser)

---

## Key Files
- `docker-compose.prod.yml` - Production stack definition
- `Dockerfile.prod` - Frontend build with nginx
- `nginx.prod.conf` - Internal routing configuration
- `injection-service/` - Image injection microservice

---

## Collaboration Protocol
- WebSocket via socket.io
- AES-GCM 128-bit encryption (room key from URL hash)
- File compression: pako (zlib deflate)
