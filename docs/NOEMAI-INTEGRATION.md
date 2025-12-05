# Excalidraw NoemAI Integration

## Vue d'ensemble

Ce projet est un fork personnalisé d'Excalidraw avec des modifications pour permettre l'ajout programmatique d'images en mode collaboration temps réel. Il est conçu pour être intégré avec NoemAI, permettant à un agent IA d'ajouter des visualisations directement sur un canvas partagé.

**URL de production**: https://excalidraw.robotsinlove.be

---

## Architecture

### Composants du système

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Browser                            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Excalidraw App                        │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │
│  │  │ excalidrawAPI│  │  collabAPI  │  │  Jotai Store    │  │    │
│  │  │ (window)     │  │  (internal) │  │  (window)       │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ WebSocket + HTTP
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Swarm (Dokploy)                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  excalidraw     │  │ excalidraw-room │  │excalidraw-storage│ │
│  │  (nginx+static) │  │  (WebSocket)    │  │  (HTTP API)     │  │
│  │  :80            │  │  :80            │  │  :8080          │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Services Docker Swarm

| Service | Image | Port | Fonction |
|---------|-------|------|----------|
| `excalidraw_excalidraw` | `noemai/excalidraw:latest` | 80 | Application frontend |
| `excalidraw_room` | `excalidraw/excalidraw-room` | 80 | Serveur WebSocket collaboration |
| `excalidraw_storage` | `alswl/excalidraw-storage-backend` | 8080 | Stockage fichiers/scènes |

### URLs publiques (via Traefik)

- **App**: https://excalidraw.robotsinlove.be
- **WebSocket**: wss://excalidraw-room.robotsinlove.be
- **Storage API**: https://excalidraw-storage.robotsinlove.be/api/v2

---

## API Programmatique

### Accès à l'API

L'API est exposée sur `window.excalidrawAPI` une fois l'application chargée:

```javascript
// Vérifier la disponibilité
if (window.excalidrawAPI) {
  console.log('API disponible');
  console.log('En collaboration:', window.excalidrawAPI.isCollaborating());
}
```

### Méthodes disponibles

#### `addImageFromDataUrl(dataUrl, x, y, mimeType, options?)`

Ajoute une image à partir d'un DataURL (base64).

```javascript
const result = await window.excalidrawAPI.addImageFromDataUrl(
  'data:image/png;base64,iVBORw0KGgo...', // DataURL de l'image
  100,                                      // Position X
  200,                                      // Position Y
  'image/png',                              // Type MIME
  {
    width: 300,                             // Largeur optionnelle
    height: 200,                            // Hauteur optionnelle
    id: 'custom-element-id'                 // ID optionnel
  }
);

console.log(result.fileId);     // ID du fichier
console.log(result.elementId);  // ID de l'élément
```

#### `addImageFromUrl(url, x, y, options?)`

Ajoute une image à partir d'une URL (fetch + conversion en DataURL).

```javascript
const result = await window.excalidrawAPI.addImageFromUrl(
  'https://example.com/image.png',
  100,
  200,
  { width: 400 }
);
```

**Note**: Nécessite que le serveur autorise CORS.

#### `isCollaborating()`

Vérifie si l'utilisateur est en mode collaboration.

```javascript
if (window.excalidrawAPI.isCollaborating()) {
  console.log('Mode collaboration actif');
}
```

#### `syncElements()`

Force une synchronisation des éléments avec les autres collaborateurs.

```javascript
window.excalidrawAPI.syncElements();
```

#### `getCollabAPI()`

Accès à l'API de collaboration interne (usage avancé).

```javascript
const collabAPI = window.excalidrawAPI.getCollabAPI();
console.log('Room link:', collabAPI.getActiveRoomLink());
```

### État Jotai (avancé)

Pour un accès avancé à l'état de l'application:

```javascript
// Store Jotai
const store = window.appJotaiStore;

// Atoms disponibles
const atoms = window.collabAtoms;
// - isCollaboratingAtom
// - collabAPIAtom
// - isOfflineAtom
```

---

## Problèmes résolus

### 1. Éléments non synchronisés (version trop basse)

**Symptôme**: Les éléments ajoutés programmatiquement n'apparaissaient pas chez les autres collaborateurs.

**Cause**: La fonction `broadcastElements()` dans `Collab.tsx` vérifie:
```typescript
if (getSceneVersion(elements) > lastBroadcastedOrReceivedSceneVersion)
```

`getSceneVersion()` = somme des `version` de tous les éléments. Avec `version: 1`, l'incrément était trop faible pour déclencher le broadcast.

**Solution** (`App.tsx:435-436`):
```typescript
// High version (100-200) ensures scene version increases enough for broadcast
version: 100 + Math.floor(Math.random() * 100),
```

### 2. Images non synchronisées (timing upload)

**Symptôme**: Les formes se synchronisaient mais pas les images.

**Cause**:
- `queueFileUpload` est throttled à 300ms
- Le broadcast WebSocket se fait IMMÉDIATEMENT
- Les autres clients reçoivent l'élément avec `status: "pending"` mais le fichier n'est pas encore sur le serveur
- Le changement de status `pending` → `saved` utilise `CaptureUpdateAction.NEVER` donc n'est pas broadcasté
- Le full sync automatique ne se fait que toutes les 20 secondes

**Solution** (`App.tsx:595-640`):
```typescript
if (collabAPI?.isCollaborating()) {
  // Force flush the throttled file upload
  const portal = (collabAPI as any).portal;
  if (portal?.queueFileUpload?.flush) {
    portal.queueFileUpload.flush();
  }

  // Wait for file to be uploaded (check element status periodically)
  await waitForUpload();

  // Force a full scene broadcast
  const queueBroadcast = (collabAPI as any).queueBroadcastAllElements;
  if (queueBroadcast?.flush) {
    queueBroadcast.flush();
  }
}
```

### 3. WebSocket vers mauvais serveur

**Symptôme**: Erreurs WebSocket vers `oss-collab.excalidraw.com`.

**Cause**: Le fichier `.env.production` contenait les URLs des serveurs Excalidraw publics.

**Solution** (`.env.production`):
```env
VITE_APP_WS_SERVER_URL=wss://excalidraw-room.robotsinlove.be
VITE_APP_HTTP_STORAGE_BACKEND_URL=https://excalidraw-storage.robotsinlove.be/api/v2
VITE_APP_STORAGE_BACKEND=http
VITE_APP_FIREBASE_CONFIG={}
```

### 4. Build échoue (bundle > 2MB)

**Symptôme**: `Error: Assets exceeding the limit: index.js is 2.3 MB`

**Cause**: Le plugin PWA (vite-plugin-pwa) a une limite par défaut de 2MB pour le cache.

**Solution** (`vite.config.mts:115-116`):
```typescript
workbox: {
  maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // 3MB
  // ...
}
```

---

## Fichiers modifiés

### `/excalidraw-app/App.tsx`

- **Lignes 408-449**: Fonction `createImageElement` avec version élevée
- **Lignes 488-494**: Fonction `triggerCollabSync`
- **Lignes 499-592**: Fonction `addImageFromUrl` avec sync forcé
- **Lignes 597-644**: Fonction `addImageFromDataUrl` avec sync forcé
- **Lignes 649-671**: Exposition de l'API sur `window`

### `/excalidraw-app/vite.config.mts`

- **Ligne 116**: `maximumFileSizeToCacheInBytes: 3 * 1024 * 1024`

### `/.env.production`

- URLs modifiées pour pointer vers les serveurs locaux

---

## Déploiement

### Build de l'image Docker

```bash
cd /home/gilles/serverlab/projects/excalidraw-noemai

# Build avec cache
docker build -t excalidraw-noemai:latest .

# Build sans cache (après modification de .env.production)
docker build --no-cache -t excalidraw-noemai:latest .
```

### Déploiement sur Swarm

```bash
# Tag pour le registry local
docker tag excalidraw-noemai:latest noemai/excalidraw:latest

# Mise à jour du service
docker service update --force excalidraw_excalidraw
```

### Vérification

```bash
# Status du service
docker service ls | grep excalidraw

# Logs
docker service logs excalidraw_excalidraw --tail 50

# Test de l'URL
curl -I https://excalidraw.robotsinlove.be
```

---

## Utilisation avec NoemAI

### Exemple: Agent ajoutant une visualisation

```javascript
// Dans le contexte du navigateur contrôlé par Playwright/Puppeteer

// 1. Attendre que l'API soit disponible
await page.waitForFunction(() => window.excalidrawAPI?.isCollaborating?.());

// 2. Créer une image (canvas, chart, etc.)
const dataUrl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 300;
  const ctx = canvas.getContext('2d');

  // Dessiner quelque chose...
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(0, 0, 400, 300);
  ctx.fillStyle = 'white';
  ctx.font = '24px Arial';
  ctx.fillText('Generated by NoemAI', 100, 150);

  return canvas.toDataURL('image/png');
});

// 3. Ajouter l'image au canvas partagé
const result = await page.evaluate(async (dataUrl) => {
  return await window.excalidrawAPI.addImageFromDataUrl(
    dataUrl,
    200, 200,
    'image/png'
  );
}, dataUrl);

console.log('Image ajoutée:', result.elementId);
```

### Flux de synchronisation

```
Agent NoemAI                    Excalidraw                 Autres collaborateurs
     │                              │                              │
     │  addImageFromDataUrl()       │                              │
     │─────────────────────────────>│                              │
     │                              │                              │
     │                              │  1. Ajoute fichier           │
     │                              │  2. Crée élément (pending)   │
     │                              │  3. Force upload fichier     │
     │                              │─────────────────────────────>│ Storage
     │                              │  4. Attend status=saved      │
     │                              │  5. Broadcast WebSocket      │
     │                              │─────────────────────────────>│
     │                              │                              │
     │  { fileId, elementId }       │  6. Autres clients           │
     │<─────────────────────────────│     téléchargent fichier     │
     │                              │                              │
```

---

## Dépannage

### L'image n'apparaît pas chez les autres

1. **Vérifier les logs console**:
   ```
   [NoemAI] Collaboration mode: forcing immediate file upload for XXX
   [NoemAI] File uploaded successfully, status: saved
   ```

2. **Vérifier le status de l'élément**:
   ```javascript
   const el = excalidrawAPI.getSceneElementsIncludingDeleted()
     .find(e => e.id === elementId);
   console.log(el.status); // Doit être "saved"
   ```

3. **Vérifier les erreurs WebSocket**:
   - Pas d'erreurs vers `oss-collab.excalidraw.com`
   - Connexion établie vers `excalidraw-room.robotsinlove.be`

### Build Docker échoue

1. **Erreur PWA > 2MB**: Vérifier `maximumFileSizeToCacheInBytes` dans `vite.config.mts`
2. **Variables non prises en compte**: Utiliser `--no-cache` pour rebuild complet

### WebSocket vers mauvais serveur

1. Vérifier `.env.production`
2. Rebuild avec `--no-cache`
3. Vider le cache navigateur (les fichiers VITE sont compilés au build time)

---

## Références

- [Excalidraw GitHub](https://github.com/excalidraw/excalidraw)
- [Excalidraw Room Server](https://github.com/excalidraw/excalidraw-room)
- [Excalidraw Storage Backend](https://github.com/alswl/excalidraw-storage-backend)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)

---

**Dernière mise à jour**: 2025-12-04
**Auteur**: Claude (NoemAI Integration)
