# NoemAI Draw

Fork personnalisé d'Excalidraw pour la collaboration AI-Humain sur canvas visuel.

**Production**: https://noemai-draw.robotsinlove.be

---

## Fonctionnalités

### v1 (Actuel - Décembre 2025)

- **Injection d'images** : Claude peut injecter des images générées dans une room de collaboration
- **Support grandes images** : Jusqu'à 50MB
- **Encryption compatible** : Format Excalidraw v2 complet (AES-GCM + concatBuffers)
- **WebSocket broadcast** : Synchronisation temps réel avec tous les participants

### v2 (Roadmap)

- **Room Registry** : Gestion persistante des rooms (création, listing, room active)
- **Canvas Agent** : Claude "voit" le contenu du canvas en temps réel
- **MCP Server** : Intégration native avec Claude Code
- **Génération intégrée** : Images générées directement par le service (pas de skill externe)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    NOEMAI-DRAW STACK                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Internet ──► Traefik ──► nginx (excalidraw container)      │
│                              │                               │
│              ┌───────────────┼───────────────┐              │
│              ↓               ↓               ↓              │
│          /api/v2       /socket.io      /api/inject          │
│              │               │               │              │
│              ↓               ↓               ↓              │
│          storage          room          injection           │
│           :8080          :3002           :3003              │
│              │                                              │
│              ↓                                              │
│           redis                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

| Service | Port | Rôle |
|---------|------|------|
| excalidraw | 80 | Frontend React + nginx proxy |
| storage | 8080 | Persistance fichiers/scènes |
| room | 3002 | WebSocket collaboration |
| injection | 3003 | API injection pour Claude |
| redis | 6379 | Backend de données |

---

## Utilisation

### Injecter une image (Claude)

```bash
python3 /home/gilles/serverlab/scripts/noemai-inject-image.py \
    "https://noemai-draw.robotsinlove.be/#room=ROOM_ID,ROOM_KEY" \
    /chemin/vers/image.png \
    --x 100 --y 100
```

### API REST

```bash
POST /api/inject/inject-image
Content-Type: application/json

{
  "roomId": "xxx",
  "roomKey": "xxx",
  "imageDataUrl": "data:image/png;base64,...",
  "x": 100,
  "y": 100,
  "width": 300,   // optionnel
  "height": 300   // optionnel
}
```

### Health Check

```bash
curl https://noemai-draw.robotsinlove.be/api/inject/health
# {"status":"ok","service":"noemai-injection"}
```

---

## Déploiement

### Méthode : GitHub → Dokploy

```bash
# 1. Faire les modifications
vim injection-service/index.js

# 2. Commit et push
git add .
git commit -m "fix: description"
git push origin main

# 3. Attendre le déploiement Dokploy (~2-3 min)

# 4. Tester
curl https://noemai-draw.robotsinlove.be/api/inject/health
```

### NE PAS utiliser docker-compose local pour la production

Le stack local peut créer des conflits Traefik avec le déploiement Dokploy.

---

## Développement Local (optionnel)

```bash
# Démarrer le stack de dev
docker compose -f docker-compose.prod.yml up -d

# Logs
docker compose -f docker-compose.prod.yml logs -f injection

# Arrêter
docker compose -f docker-compose.prod.yml down
```

---

## Roadmap v2

### 1. Room Registry
```
POST   /api/rooms              → Créer une room
GET    /api/rooms              → Lister les rooms
GET    /api/rooms/:name        → Détails
POST   /api/rooms/:name/join   → Connecter l'agent
DELETE /api/rooms/:name        → Supprimer
```

### 2. Canvas Agent
- Connexion WebSocket persistante
- État local des éléments du canvas
- API `GET /api/rooms/:name/state`

### 3. MCP Server
```javascript
// Tools Claude Code
create_room(name)           // Crée une room
list_rooms()                // Liste les rooms
set_active_room(name)       // Définit la room courante
get_canvas()                // État du canvas
inject_image(prompt, x, y)  // Génère + injecte
inject_element(type, props) // Ajoute forme/texte
```

### 4. Image Generation intégrée
- Appel Gemini API direct
- Variable d'environnement `GEMINI_API_KEY`
- Plus besoin de skill externe

---

## Variables d'Environnement

### v1 (actuel)
```env
PORT=3003
STORAGE_BACKEND_URL=http://storage:8080
ROOM_SERVER_URL=http://room:3002
```

### v2 (à venir)
```env
PORT=3003
STORAGE_BACKEND_URL=http://storage:8080
ROOM_SERVER_URL=http://room:3002
REDIS_URL=redis://redis:6379
GEMINI_API_KEY=<your-key>
```

---

## Troubleshooting

| Problème | Cause | Solution |
|----------|-------|----------|
| 413 Request Too Large | Limite body dépassée | Vérifier Traefik/nginx/Express (50MB) |
| Image grise avec icône interdit | Format fichier incorrect | Vérifier concatBuffers format |
| 404 sur /api/inject | Nginx mal configuré | Vérifier location block |
| Conflit Traefik | Double stack | Arrêter le stack local |

---

## Fichiers Clés

| Fichier | Description |
|---------|-------------|
| `docker-compose.prod.yml` | Stack production |
| `nginx.prod.conf` | Routage interne |
| `injection-service/index.js` | Service d'injection |
| `CLAUDE.md` | Contexte pour Claude Code |

---

## Références

- [Excalidraw](https://github.com/excalidraw/excalidraw)
- [excalidraw-room](https://github.com/excalidraw/excalidraw-room)
- [excalidraw-storage-backend](https://github.com/alswl/excalidraw-storage-backend)

---

*Projet maintenu par ServerLab pour l'intégration NoemAI*
