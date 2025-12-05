# NoemAI Draw v2 - Roadmap

## Vision

Transformer NoemAI Draw d'un "outil d'injection" en une **plateforme de collaboration AI-Humain sur canvas visuel**.

```
AVANT (v1)                          APRES (v2)
─────────────────                   ─────────────────
Claude injecte                      Claude collabore
  ↓                                   ↕
Canvas                              Canvas
  ↓                                   ↕
Humain voit                         Humain interagit
```

---

## Architecture Cible

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NOEMAI-DRAW SERVICE v2                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   Room       │    │   Canvas     │    │   Image      │                  │
│  │   Registry   │    │   Agent      │    │   Generator  │                  │
│  │   (Redis)    │    │   (WS)       │    │   (Gemini)   │                  │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                  │
│         │                   │                   │                          │
│         └───────────────────┼───────────────────┘                          │
│                             │                                              │
│                    ┌────────┴────────┐                                     │
│                    │   MCP Server    │                                     │
│                    │                 │                                     │
│                    │ • create_room   │                                     │
│                    │ • get_canvas    │                                     │
│                    │ • inject_*      │                                     │
│                    │ • generate_img  │                                     │
│                    └────────┬────────┘                                     │
│                             │                                              │
└─────────────────────────────┼──────────────────────────────────────────────┘
                              │
                              ↓
                    ┌─────────────────┐
                    │  Claude Agent   │
                    │  (via MCP)      │
                    └─────────────────┘
```

---

## Composants

### 1. Room Registry

**But** : Gérer le cycle de vie des rooms de manière persistante.

**Stockage** : Redis (déjà utilisé par storage backend)

```
ROOMS:index              → ["brainstorm", "projet-alpha", "default"]
ROOMS:brainstorm         → {
                             "roomId": "e372d32007cb6968187e",
                             "roomKey": "_To6Zl2E88qk9mHo62udlw",
                             "name": "Brainstorm Décembre",
                             "createdAt": "2025-12-05T10:00:00Z",
                             "createdBy": "gilles",
                             "lastActive": "2025-12-05T11:30:00Z"
                           }
ROOMS:active             → "brainstorm"
```

**API REST** :
```
POST   /api/rooms                    → Créer une room
GET    /api/rooms                    → Lister les rooms
GET    /api/rooms/:name              → Détails d'une room
PUT    /api/rooms/:name              → Mettre à jour métadonnées
DELETE /api/rooms/:name              → Supprimer une room
POST   /api/rooms/:name/activate     → Définir comme room active
GET    /api/rooms/active             → Obtenir la room active
```

**Implémentation** : `injection-service/rooms.js`

---

### 2. Canvas Agent

**But** : Permettre à Claude de "voir" le contenu du canvas.

**Fonctionnement** :
1. Connexion WebSocket persistante à la room active
2. Écoute de tous les `client-broadcast` events
3. Déchiffrement et mise à jour de l'état local
4. Exposition via API REST

**État maintenu** :
```javascript
{
  roomName: "brainstorm",
  connected: true,
  lastUpdate: "2025-12-05T11:30:00Z",
  elements: [
    { id: "abc", type: "rectangle", x: 100, y: 100, width: 200, height: 150 },
    { id: "def", type: "text", text: "Hello", x: 150, y: 300 },
    { id: "ghi", type: "image", x: 400, y: 100, fileId: "noemai-xxx" }
  ],
  summary: {
    rectangle: 1,
    text: 1,
    image: 1
  },
  boundingBox: {
    minX: 100, maxX: 600,
    minY: 100, maxY: 400
  }
}
```

**API REST** :
```
GET  /api/rooms/:name/state          → État complet du canvas
GET  /api/rooms/:name/summary        → Résumé (types + count)
POST /api/rooms/:name/join           → Connecter l'agent à cette room
POST /api/rooms/:name/leave          → Déconnecter l'agent
```

**Implémentation** : `injection-service/agent.js`

---

### 3. Image Generator

**But** : Générer des images directement depuis le service, sans skill externe.

**Fonctionnement** :
1. Reçoit un prompt
2. Appelle Gemini API
3. Retourne l'image en base64

**Configuration** :
```env
GEMINI_API_KEY=AIzaSyDmjuw2i82QZvzFP0OZKkZuacfWPwBRcc4
GEMINI_MODEL=gemini-2.5-flash-image  # ou gemini-3-pro-image-preview
```

**API REST** :
```
POST /api/generate
{
  "prompt": "A cute robot waving hello",
  "model": "flash",        // flash (rapide) ou pro (qualité)
  "aspectRatio": "1:1"     // 1:1, 16:9, 9:16, 4:3
}

Response:
{
  "success": true,
  "imageDataUrl": "data:image/png;base64,...",
  "model": "gemini-2.5-flash-image"
}
```

**Implémentation** : `injection-service/generator.js`

---

### 4. MCP Server

**But** : Intégration native avec Claude Code via le protocole MCP.

**Tools exposés** :

| Tool | Description | Paramètres |
|------|-------------|------------|
| `create_room` | Crée une nouvelle room | `name: string` |
| `list_rooms` | Liste les rooms existantes | - |
| `set_active_room` | Définit la room active | `name: string` |
| `get_canvas` | Retourne l'état du canvas | `name?: string` (défaut: active) |
| `inject_image` | Génère et injecte une image | `prompt: string, x: number, y: number` |
| `inject_element` | Injecte un élément (forme, texte) | `type: string, props: object` |
| `get_room_url` | Retourne l'URL de la room | `name?: string` |

**Configuration MCP** : `.mcp.json`
```json
{
  "mcpServers": {
    "noemai-draw": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": {
        "NOEMAI_API_URL": "http://localhost:3003"
      }
    }
  }
}
```

**Implémentation** : `injection-service/mcp-server.js`

---

## Plan d'Implémentation

### Phase 1 : Room Registry (2h)

```javascript
// injection-service/rooms.js

const Redis = require('ioredis');
const crypto = require('crypto');

class RoomRegistry {
  constructor(redisUrl) {
    this.redis = new Redis(redisUrl);
  }

  async createRoom(name) {
    const roomId = crypto.randomBytes(12).toString('hex');
    const roomKey = crypto.randomBytes(16).toString('base64url');

    const room = {
      roomId,
      roomKey,
      name,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };

    await this.redis.set(`ROOMS:${name}`, JSON.stringify(room));
    await this.redis.sadd('ROOMS:index', name);

    return room;
  }

  async getRoom(name) { ... }
  async listRooms() { ... }
  async deleteRoom(name) { ... }
  async setActiveRoom(name) { ... }
  async getActiveRoom() { ... }
}
```

### Phase 2 : Canvas Agent (3h)

```javascript
// injection-service/agent.js

const { io } = require('socket.io-client');

class CanvasAgent {
  constructor(roomServerUrl) {
    this.roomServerUrl = roomServerUrl;
    this.socket = null;
    this.elements = new Map();
    this.roomKey = null;
  }

  async joinRoom(roomId, roomKey) {
    this.roomKey = roomKey;
    this.socket = io(this.roomServerUrl, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      this.socket.emit('join-room', roomId);
    });

    this.socket.on('client-broadcast', (data, iv) => {
      const decrypted = this.decrypt(data, iv);
      this.handleUpdate(decrypted);
    });
  }

  handleUpdate(data) {
    if (data.type === 'SCENE_UPDATE') {
      for (const el of data.payload.elements) {
        if (el.isDeleted) {
          this.elements.delete(el.id);
        } else {
          this.elements.set(el.id, el);
        }
      }
    }
  }

  getState() {
    return {
      elements: Array.from(this.elements.values()),
      summary: this.getSummary(),
      boundingBox: this.getBoundingBox()
    };
  }
}
```

### Phase 3 : MCP Server (2h)

```javascript
// injection-service/mcp-server.js

const { Server } = require('@modelcontextprotocol/sdk/server');

const server = new Server({
  name: 'noemai-draw',
  version: '1.0.0'
});

server.setRequestHandler('tools/list', async () => ({
  tools: [
    {
      name: 'create_room',
      description: 'Create a new collaboration room',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Room name' }
        },
        required: ['name']
      }
    },
    // ... autres tools
  ]
}));

server.setRequestHandler('tools/call', async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'create_room':
      return await roomRegistry.createRoom(args.name);
    case 'get_canvas':
      return await canvasAgent.getState();
    // ...
  }
});
```

### Phase 4 : Image Generator (2h)

```javascript
// injection-service/generator.js

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function generateImage(prompt, model = 'flash', aspectRatio = '1:1') {
  const modelId = model === 'pro'
    ? 'gemini-3-pro-image-preview'
    : 'gemini-2.5-flash-image';

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'image/png',
          aspectRatio
        }
      })
    }
  );

  const data = await response.json();
  const imageData = data.candidates[0].content.parts[0].inlineData;

  return `data:${imageData.mimeType};base64,${imageData.data}`;
}
```

### Phase 5 : Tests E2E (1h)

```bash
# Test Room Registry
curl -X POST http://localhost:3003/api/rooms -d '{"name":"test"}' -H "Content-Type: application/json"
curl http://localhost:3003/api/rooms
curl http://localhost:3003/api/rooms/test

# Test Canvas Agent
curl -X POST http://localhost:3003/api/rooms/test/join
curl http://localhost:3003/api/rooms/test/state

# Test Image Generator
curl -X POST http://localhost:3003/api/generate -d '{"prompt":"robot"}' -H "Content-Type: application/json"

# Test MCP (via Claude Code)
# Configurer .mcp.json puis utiliser les tools dans Claude
```

---

## Structure Fichiers Finale

```
injection-service/
├── index.js           # Point d'entrée, Express routes
├── rooms.js           # Room Registry (Redis)
├── agent.js           # Canvas Agent (WebSocket)
├── generator.js       # Image Generator (Gemini)
├── crypto.js          # Encryption utils (existant, refactoré)
├── mcp-server.js      # MCP Server (standalone ou intégré)
├── package.json
└── Dockerfile
```

---

## Variables d'Environnement v2

```env
# Existantes
PORT=3003
STORAGE_BACKEND_URL=http://storage:8080
ROOM_SERVER_URL=http://room:3002

# Nouvelles
REDIS_URL=redis://redis:6379
GEMINI_API_KEY=AIzaSyDmjuw2i82QZvzFP0OZKkZuacfWPwBRcc4
GEMINI_MODEL=gemini-2.5-flash-image
```

---

## Workflow Utilisateur Final

```
User: "Crée un canvas pour notre brainstorm"
Claude: [MCP: create_room("brainstorm-dec")]
        → "Room créée! URL: https://noemai-draw...//#room=xxx,yyy"
        → Ouvre automatiquement dans le navigateur (optionnel)

User: "Dessine un robot au centre"
Claude: [MCP: get_canvas()]
        → Voit canvas vide
        [MCP: inject_image("cute robot waving", 400, 300)]
        → "Robot ajouté au centre"

User: "Qu'est-ce qu'il y a dans le canvas maintenant?"
Claude: [MCP: get_canvas()]
        → "Le canvas contient: 1 image (robot) à (400, 300)"

User: "Ajoute un titre au-dessus"
Claude: [MCP: inject_element("text", {text: "Notre Mascotte", x: 400, y: 200})]
        → "Titre ajouté"

User: (dessine un rectangle dans le canvas)
Claude: [MCP: get_canvas()]  // Voit le nouveau rectangle
        → "Je vois que tu as ajouté un rectangle. Tu veux que j'y mette du texte?"
```

---

## Timeline Estimée

| Phase | Durée | Dépendances |
|-------|-------|-------------|
| Phase 1: Room Registry | 2h | - |
| Phase 2: Canvas Agent | 3h | Phase 1 |
| Phase 3: MCP Server | 2h | Phase 1, 2 |
| Phase 4: Image Generator | 2h | - |
| Phase 5: Tests E2E | 1h | Tout |

**Total**: ~10h de développement

---

*Document créé le 5 décembre 2025*
