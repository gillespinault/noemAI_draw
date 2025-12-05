/**
 * NoemAI Draw - Image Injection Service
 *
 * Allows external systems (like Claude) to inject images into
 * Excalidraw collaboration rooms.
 *
 * Flow:
 * 1. POST /inject-image with { roomId, roomKey, imageDataUrl, x, y }
 * 2. Service encrypts image, uploads to storage backend
 * 3. Connects to room WebSocket, broadcasts new element
 * 4. All collaborators receive the image
 */

const express = require('express');
const cors = require('cors');
const { io } = require('socket.io-client');
const crypto = require('crypto');
const pako = require('pako');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.raw({ limit: '50mb', type: 'application/octet-stream' }));

// Configuration
const STORAGE_BACKEND_URL = process.env.STORAGE_BACKEND_URL || 'http://storage:8080';
const ROOM_SERVER_URL = process.env.ROOM_SERVER_URL || 'http://room:3002';
const PORT = process.env.PORT || 3003;

// ============================================================
// Crypto utilities (matching Excalidraw's implementation)
// ============================================================

const IV_LENGTH_BYTES = 12;

function createIV() {
  return crypto.randomBytes(IV_LENGTH_BYTES);
}

/**
 * Import key from JWK format (base64url encoded)
 */
function importKey(keyStr) {
  // JWK k field is base64url encoded
  const keyBuffer = Buffer.from(keyStr.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return keyBuffer;
}

/**
 * Encrypt data using AES-GCM (matching Excalidraw)
 */
function encryptData(keyStr, data) {
  const key = importKey(keyStr);
  const iv = createIV();
  const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  return { encryptedBuffer: encrypted, iv };
}

/**
 * Excalidraw's concatBuffers format:
 * [VERSION:4bytes][LEN1:4bytes][DATA1][LEN2:4bytes][DATA2]...
 */
function concatBuffers(...buffers) {
  const CONCAT_BUFFERS_VERSION = 1;

  // Calculate total size
  const totalSize = 4 + buffers.reduce((acc, buf) => acc + 4 + buf.length, 0);
  const result = Buffer.alloc(totalSize);

  let cursor = 0;

  // Write version (4 bytes, big-endian)
  result.writeUInt32BE(CONCAT_BUFFERS_VERSION, cursor);
  cursor += 4;

  // Write each buffer with its length prefix
  for (const buf of buffers) {
    result.writeUInt32BE(buf.length, cursor);
    cursor += 4;
    buf.copy(result, cursor);
    cursor += buf.length;
  }

  return result;
}

/**
 * Compress and encrypt file data (matching Excalidraw's exact format)
 *
 * Format: concatBuffers([
 *   encodingMetadata,  // JSON: {version:2, compression:"pako@1", encryption:"AES-GCM"}
 *   iv,                // 12 bytes
 *   encrypt(deflate(concatBuffers([
 *     contentsMetadata,  // JSON: {mimeType, created, ...}
 *     dataBuffer         // actual file bytes
 *   ])))
 * ])
 */
function compressAndEncryptFile(keyStr, dataUrl, mimeType) {
  // Encoding metadata (outer wrapper info)
  const encodingMetadata = {
    version: 2,
    compression: "pako@1",
    encryption: "AES-GCM"
  };
  const encodingMetadataBuffer = Buffer.from(JSON.stringify(encodingMetadata), 'utf-8');

  // Contents metadata (file info)
  const contentsMetadata = {
    mimeType: mimeType || 'image/png',
    created: Date.now()
  };
  const contentsMetadataBuffer = Buffer.from(JSON.stringify(contentsMetadata), 'utf-8');

  // File data (the dataURL as bytes)
  const dataBuffer = Buffer.from(dataUrl, 'utf-8');

  // Inner structure: concatBuffers(contentsMetadata, dataBuffer)
  const innerConcat = concatBuffers(contentsMetadataBuffer, dataBuffer);

  // Compress the inner structure
  const compressed = pako.deflate(innerConcat);

  // Encrypt the compressed data
  const { encryptedBuffer, iv } = encryptData(keyStr, Buffer.from(compressed));

  // Final structure: concatBuffers(encodingMetadata, iv, encryptedBuffer)
  return concatBuffers(encodingMetadataBuffer, iv, encryptedBuffer);
}

/**
 * Generate unique file ID
 */
function generateFileId() {
  return `noemai-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Generate unique element ID
 */
function generateElementId() {
  return `noemai-img-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ============================================================
// Storage Backend API
// ============================================================

async function uploadFileToStorage(fileId, encryptedBuffer) {
  const response = await fetch(`${STORAGE_BACKEND_URL}/api/v2/files/${fileId}`, {
    method: 'PUT',
    body: encryptedBuffer,
    headers: {
      'Content-Type': 'application/octet-stream'
    }
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed: ${response.status}`);
  }

  return true;
}

// ============================================================
// WebSocket Room Communication
// ============================================================

async function broadcastImageElement(roomId, roomKey, element) {
  return new Promise((resolve, reject) => {
    const socket = io(ROOM_SERVER_URL, {
      transports: ['websocket'],
      timeout: 10000
    });

    socket.on('connect', () => {
      console.log(`[Injection] Connected to room server`);

      // Join the room
      socket.emit('join-room', roomId);
    });

    socket.on('init-room', () => {
      console.log(`[Injection] Room initialized, broadcasting element`);

      // Prepare the update message
      const data = {
        type: 'SCENE_UPDATE',
        payload: {
          elements: [element]
        }
      };

      // Encrypt the message
      const json = JSON.stringify(data);
      const encoded = Buffer.from(json, 'utf-8');
      const { encryptedBuffer, iv } = encryptData(roomKey, encoded);

      // Emit the update (server-broadcast is the correct event name)
      // Convert to ArrayBuffer/Uint8Array format expected by room server
      const encryptedArray = new Uint8Array(encryptedBuffer);
      const ivArray = new Uint8Array(iv);
      socket.emit('server-broadcast', roomId, encryptedArray, ivArray);

      console.log(`[Injection] Element broadcast complete`);

      // Disconnect after a short delay
      setTimeout(() => {
        socket.disconnect();
        resolve({ success: true, elementId: element.id });
      }, 500);
    });

    socket.on('connect_error', (error) => {
      console.error(`[Injection] Connection error:`, error.message);
      reject(error);
    });

    // Timeout
    setTimeout(() => {
      socket.disconnect();
      reject(new Error('Timeout connecting to room'));
    }, 15000);
  });
}

// ============================================================
// API Endpoints
// ============================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'noemai-injection' });
});

/**
 * Main injection endpoint
 *
 * POST /inject-image
 * Body: {
 *   roomId: string,      // Room ID from URL hash
 *   roomKey: string,     // Room key from URL hash
 *   imageDataUrl: string,// data:image/png;base64,...
 *   x: number,           // Position X (optional, default 100)
 *   y: number,           // Position Y (optional, default 100)
 *   width: number,       // Width (optional, auto-calculated)
 *   height: number       // Height (optional, auto-calculated)
 * }
 */
app.post('/inject-image', async (req, res) => {
  try {
    const { roomId, roomKey, imageDataUrl, x = 100, y = 100, width, height } = req.body;

    // Validation
    if (!roomId || !roomKey || !imageDataUrl) {
      return res.status(400).json({
        error: 'Missing required fields: roomId, roomKey, imageDataUrl'
      });
    }

    if (!imageDataUrl.startsWith('data:image/')) {
      return res.status(400).json({
        error: 'imageDataUrl must be a valid data URL (data:image/...)'
      });
    }

    console.log(`[Injection] Processing image for room ${roomId}`);

    // Extract mime type
    const mimeType = imageDataUrl.match(/data:([^;]+);/)?.[1] || 'image/png';

    // Generate IDs
    const fileId = generateFileId();
    const elementId = generateElementId();

    // Encrypt and upload file
    console.log(`[Injection] Encrypting and uploading file ${fileId}`);
    const encryptedFile = compressAndEncryptFile(roomKey, imageDataUrl, mimeType);
    await uploadFileToStorage(fileId, encryptedFile);

    // Calculate dimensions (default or from request)
    const imgWidth = width || 300;
    const imgHeight = height || 300;

    // Create image element (matching Excalidraw format)
    const element = {
      id: elementId,
      type: 'image',
      x: x,
      y: y,
      width: imgWidth,
      height: imgHeight,
      angle: 0,
      strokeColor: 'transparent',
      backgroundColor: 'transparent',
      fillStyle: 'solid',
      strokeWidth: 1,
      strokeStyle: 'solid',
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      index: `a${Date.now()}`,
      roundness: null,
      seed: Math.floor(Math.random() * 1000000000),
      version: Date.now(),
      versionNonce: Math.floor(Math.random() * 1000000000),
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: 'saved',
      fileId: fileId,
      scale: [1, 1]
    };

    // Broadcast to room
    console.log(`[Injection] Broadcasting element to room`);
    const result = await broadcastImageElement(roomId, roomKey, element);

    console.log(`[Injection] Success! Element ${elementId} injected`);
    res.json({
      success: true,
      elementId: elementId,
      fileId: fileId
    });

  } catch (error) {
    console.error(`[Injection] Error:`, error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Simple text/shape injection (no file upload needed)
 */
app.post('/inject-element', async (req, res) => {
  try {
    const { roomId, roomKey, element } = req.body;

    if (!roomId || !roomKey || !element) {
      return res.status(400).json({
        error: 'Missing required fields: roomId, roomKey, element'
      });
    }

    // Ensure element has required fields
    const completeElement = {
      id: element.id || generateElementId(),
      version: Date.now(),
      versionNonce: Math.floor(Math.random() * 1000000000),
      isDeleted: false,
      groupIds: [],
      boundElements: [],
      frameId: null,
      ...element
    };

    const result = await broadcastImageElement(roomId, roomKey, completeElement);
    res.json({ success: true, elementId: completeElement.id });

  } catch (error) {
    console.error(`[Injection] Error:`, error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Start Server
// ============================================================

app.listen(PORT, () => {
  console.log(`[NoemAI Injection Service] Running on port ${PORT}`);
  console.log(`[NoemAI Injection Service] Storage backend: ${STORAGE_BACKEND_URL}`);
  console.log(`[NoemAI Injection Service] Room server: ${ROOM_SERVER_URL}`);
});
