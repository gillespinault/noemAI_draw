# Excalidraw NoemAI Fork

Fork personnalisé d'Excalidraw pour l'intégration avec NoemAI - permettant l'ajout programmatique d'images en mode collaboration temps réel.

## Déploiement

**Production**: https://excalidraw.robotsinlove.be

## Fonctionnalités ajoutées

- **API programmatique** exposée sur `window.excalidrawAPI`
- **Ajout d'images** via `addImageFromDataUrl()` et `addImageFromUrl()`
- **Synchronisation collaboration** forcée pour les images
- **Compatibilité** avec Playwright/Puppeteer pour automatisation

## Quick Start

```javascript
// Ajouter une image en mode collaboration
const result = await window.excalidrawAPI.addImageFromDataUrl(
  'data:image/png;base64,...',
  100, 200,  // position x, y
  'image/png'
);
console.log('Image ajoutée:', result.elementId);
```

## Documentation complète

Voir **[docs/NOEMAI-INTEGRATION.md](docs/NOEMAI-INTEGRATION.md)** pour:
- Architecture détaillée
- API complète
- Problèmes résolus
- Guide de déploiement
- Dépannage

## Build & Deploy

```bash
# Build
docker build -t excalidraw-noemai:latest .

# Deploy (Swarm)
docker tag excalidraw-noemai:latest noemai/excalidraw:latest
docker service update --force excalidraw_excalidraw
```

## Stack technique

| Composant | Technologie |
|-----------|-------------|
| Frontend | React + Vite |
| Collaboration | WebSocket (excalidraw-room) |
| Storage | HTTP backend (excalidraw-storage) |
| Hosting | Docker Swarm + Traefik |

---

*Fork maintenu par ServerLab pour l'intégration NoemAI*
