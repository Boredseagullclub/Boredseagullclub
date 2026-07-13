require('dotenv').config();
const userRoutes = require('../routes/userRoutes'); // 🦅 Add this line!
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const StellarSdk = require('stellar-sdk');
const mongoose = require('mongoose');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const kycRoutes = require('../routes/kycRoutes');
const walletRoutes = require('../routes/walletRoutes');
const authRoutes = require('../routes/auth');
const logger = require('../logger');
const { performFullAudit } = require('./reconciler');
const { runConfirmationCycle } = require('../services/ConfirmationEngine');
const { startXrplListener, getSyncStatus } = require('../xrplListener');
const startStellarListener = require('../stellarListener');
const { startHederaListener } = require('../hederaListener');
const startEvmListeners = require('../evmListener');
const { initSocket } = require('../socketService');
const { sweepProfits } = require('../SweepService'); // Add this!
const bridgeRoutes = require('../routes/bridgeRoutes');
const xrpl = require('xrpl');
const { ethers } = require('ethers');
const validateAddress = require('../middleware/validateAddress');
const { register, passkeySuccessCounter, maintenanceGauge, xrplLagGauge, lastAuditStatusGauge } = require('../services/metrics');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;
const bip39 = require('bip39');
const { Wallet } = require('xrpl');
const { Keypair } = require('stellar-sdk');
const { derivePath } = require('ed25519-hd-key');
const { Client, PrivateKey, AccountId, TransferTransaction, Hbar, TokenId } = require('@hashgraph/sdk');
const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");
const rekognition = new RekognitionClient({ region: "us-east-1" });
const slotRoutes = require('../routes/slotRoutes');
const { router: pricesRouter, startBackgroundDataLogging } = require('../routes/prices');
const supportRouter = require('../routes/support');
const { executeMultiChainScout } = require('./services/ScoutEngine');
const { triggerGlobalEcosystemSync } = require('./services/HolderIndexer');


// Critical env check
const criticalEnvVars = ['MONGO_URI', 'XRP_HOT_WALLET_SEED', 'XDC_HOT_WALLET_KEY', 'FLR_HOT_WALLET_KEY', 'XLM_HOT_WALLET_SECRET', 'HBAR_HOT_WALLET_KEY', 'ADMIN_SECRET', 'JWT_SECRET', 'RP_ID', 'FRONTEND_URL', 'PORT'];
criticalEnvVars.forEach(key => {
  if (!process.env[key]) {
    logger.fatal({ event: 'missing_critical_env', key });
    process.exit(1);
  }
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ['http://209.38.68.164:5173', 'https://seagull-xlm.xyz', 'https://www.seagull-xlm.xyz'],
  credentials: true
}));

app.use(bodyParser.json({ limit: '100kb' }));
app.set('trust proxy', 1);

// Apply ONLY to: /api/auth/login, /api/auth/register, /api/agent/kyc/submit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Raised from 20 to 100 to tolerate tab refreshes and background session checks
  message: { error: 'Too many authentication attempts. Institutional lock engaged.' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});

// 2. ⚡ GLOBAL API / BRIDGE TRANSACTION LIMITER
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // Allows up to 5 requests per second per IP—perfect for rapid UI clicks and fast API calls
  message: { error: 'API threshold exceeded. Please throttle concurrent bridge queries.' },
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  validate: { xForwardedForHeader: false }
});


// JWT Auth
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logger.warn({ event: 'jwt_verify_failed', error: err.message });
    return res.status(403).json({ error: 'Invalid token' });
  }
};

app.locals.authenticateJWT = authenticateJWT;

// Timing-safe admin auth (no length leak)
const adminAuth = (req, res, next) => {
  const providedKey = String(req.headers['x-admin-key'] || '');
  const expectedKey = String(process.env.ADMIN_SECRET || '');

  // Always perform constant-time comparison (no early returns based on length or emptiness)
  const providedBuffer = Buffer.from(providedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  // If lengths differ, compare provided against itself (always false) to keep timing consistent
  const lengthsMatch = providedBuffer.length === expectedBuffer.length;
  const isEqual = lengthsMatch
    ? crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    : !crypto.timingSafeEqual(providedBuffer, providedBuffer); // dummy compare for constant time

  if (!isEqual) {
    logger.warn({ event: 'unauthorized_admin_attempt', ip: req.ip });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/root/Boredseagullclub/uploads/kyc_docs/'); // Protected server directory
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Only allow secure image/PDF formats
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  } else {
    cb(new Error('Only images (JPEG, JPG, PNG) and PDFs are allowed for ID validation.'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});


// Routes
app.use('/api/wallet', walletRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/games', slotRoutes);
app.use('/api/swap', require('../routes/swap'));
app.use('/api/bridge/support', supportRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/bridge', bridgeRoutes);
app.use(express.static(path.join(__dirname, '..', 'dist')));
// Health & metrics
app.get('/api/health/status', async (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const status = getSyncStatus();
  xrplLagGauge.set(status.gap || 0);
  maintenanceGauge.set(maintenanceMode ? 1 : 0);

  const isHealthy = dbConnected && !maintenanceMode && status.processedLedger > 0 && status.gap < 30;
  res.status(isHealthy ? 200 : 503).json({
    healthy: isHealthy,
    dbConnected,
    maintenance: maintenanceMode,
    xrpl: status,
    lastAudit: { status: lastAuditStatus, lastRun: lastAuditTime },
  });
});

app.get('/metrics', async (req, res) => {
  res.setHeader('Content-Type', register.contentType);
  res.send(await register.metrics());
});

// Admin endpoints
app.post('/admin/maintenance', adminAuth, (req, res) => {
  maintenanceMode = !!req.body.enabled;
  maintenanceGauge.set(maintenanceMode ? 1 : 0);
  logger.info({ module: 'Admin', event: 'maintenance_mode_change', enabled: maintenanceMode });
  res.json({ success: true, maintenance: maintenanceMode });
});

app.post('/admin/audit', adminAuth, async (req, res) => {
  try {
    const report = await performFullAudit();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/admin/sweep', adminAuth, async (req, res) => {
  const { token, chain } = req.body;
  try {
    const result = await sweepProfits(token, chain);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🦅 MASTER TREASURY ROUTING DICTIONARY
const TREASURY_DEPOSITS = {
  XRPL: { address: 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF' },
  XLM: { address: 'GD2VMYH62JD2ZGTMMWFCU5YNMASC5NWZ5FM5WN2GWLYAACYXP6BKG44I' },
  HBAR: { address: '0.0.10419620' },
  XDC: { address: 'xdc3B51F488f729e5Cfa566990Fd7f069F364b6984D' },
  FLARE: { address: '0x6FeD6C7501Ac980548DAE096F022Ae3758E6DecC' }
};

app.post('/api/bridge/intent', async (req, res) => {
    const { amount, symbol, fromChain, toChain, destinationAddress, userId } = req.body;

    try {
        // 🦅 GENERATE SOVEREIGN TICKET
        const uniqueMemo = Math.floor(100000 + Math.random() * 900000).toString();

        console.log(`🎫 Bridge Ticket Generated: ${uniqueMemo} for ${userId}`);

        const depositAddr = TREASURY_DEPOSITS[fromChain?.toUpperCase()]?.address;
        
        if (!depositAddr) {
            throw new Error(`Unsupported bridge origin chain: ${fromChain}`);
        }

        // 🦅 ACTUALLY SAVE THE TICKET TO THE DATABASE
        const mongoose = require('mongoose');
        
        // IMPORTANT: If your GET /api/bridge/tickets route reads from a different collection
        // (like 'bridge_intents' or 'deposits'), change 'tickets' below to match it.
        await mongoose.connection.db.collection('tickets').insertOne({
            userId: userId?.toLowerCase(),
            address: userId?.toLowerCase(), // Fills both fields to guarantee the UI filter catches it
            amount: amount,
            symbol: symbol,
            fromChain: fromChain,
            toChain: toChain,
            destinationAddress: destinationAddress,
            memo: uniqueMemo,
            depositAddress: depositAddr,
            status: 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date()
        });

        res.json({
            success: true,
            memo: uniqueMemo,
            depositAddress: depositAddr
        });
    } catch (err) {
        console.error("Bridge Intent Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🦅 DYNAMIC USER TICKET HEARTBEAT ROUTE
app.get('/api/bridge/tickets/:userId', async (req, res) => {
    try {
        const userId = req.params.userId?.toLowerCase();
        if (!userId) return res.json({ success: true, tickets: [] });

        const mongoose = require('mongoose');
        
        // This queries the exact same 'tickets' collection we are saving to
        const userTickets = await mongoose.connection.db.collection('tickets').find({
            $or: [
                { userId: userId },
                { address: userId }
            ]
        }).toArray();

        res.json({
            success: true,
            tickets: userTickets
        });
    } catch (err) {
        console.error("Heartbeat Ticket Fetch Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// 🦅 THE MACHINE DISCOVERY BEACON: Public Model Context Protocol Endpoint
app.get('/.well-known/mcp.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    mcpVersion: "2026.1.0",
    serverName: "Seagull Sovereign Gateway L2",
    serverVersion: "2.0.0",
    description: "Maximum-security, constant-time, non-custodial cross-chain clearinghouse routing XRPL, Stellar, Hedera, XDC, and Flare.",
    capabilities: {
      tools: true,
      resources: false
    },
    tools: [
      {
        name: "agent_handshake",
        description: "Registers an autonomous machine entity with the gateway and yields a secure session bearer JWT.",
        inputSchema: {
          type: "object",
          properties: {
            walletAddress: { type: "string", description: "The public cryptographic address of the calling agent." },
            name: { type: "string", description: "A machine identifier or operator name." }
          },
          required: ["walletAddress"]
        },
        endpoint: "/api/agent/handshake"
      },
      {
        name: "generate_bridge_intent",
        description: "Generates an atomic, tracking-isolated cross-chain transfer ticket and returns a custom deposit memo.",
        inputSchema: {
          type: "object",
          properties: {
            amount: { type: "number", description: "The volume of liquidity to transfer." },
            symbol: { type: "string", enum: ["SGC", "SGCN", "SGH", "SGCSH", "NATIVE"] },
            fromChain: { type: "string", enum: ["XRPL", "STELLAR", "HEDERA", "XDC", "FLARE"] },
            toChain: { type: "string", enum: ["XRPL", "STELLAR", "HEDERA", "XDC", "FLARE"] },
            destinationAddress: { type: "string", description: "The recipient address on the target ledger." },
            userId: { type: "string", description: "The authenticated agent's assigned ID." }
          },
          required: ["amount", "symbol", "fromChain", "toChain", "destinationAddress", "userId"]
        },
        endpoint: "/api/bridge/intent"
      },
      {
        name: "broadcast_signature_blob",
        description: "Transmits programmatically signed transaction hex blobs or XDR strings to native L1 ledgers and commits banking-grade ISO 20022 xml archives.",
        inputSchema: {
          type: "object",
          properties: {
            chain: { type: "string", enum: ["XRPL", "STELLAR", "HEDERA", "XDC", "FLARE"] },
            asset: { type: "string" },
            amount: { type: "string" },
            recipient: { type: "string" },
            memo: { type: "string", description: "The tracking memo number extracted from the bridge intent ticket." },
            signedBlob: { type: "string", description: "The raw cryptographic signature string compiled by the machine key." }
          },
          required: ["chain", "asset", "amount", "recipient", "signedBlob"]
        },
        endpoint: "/api/wallet/broadcast"
      }
    ]
  });
});

// 🦅 TRUE ANCHORED STELLAR & ISO 20022 IDENTITY ROUTE
app.get('/.well-known/stellar.toml', (req, res) => {
    // Force UTF-8 explicitly to prevent character corruption
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const anchoredTomlData = `VERSION="2.2.0"

NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

[DOCUMENTATION]
ORG_NAME="SeagullCash"
ORG_DBA="SeagullCash"
ORG_URL="https://linktr.ee/boredseagullclub"
ORG_LOGO="https://files.catbox.moe/w3cets.png"
ORG_OFFICIAL_EMAIL="boredseagulls@gmail.com"
ORG_SUPPORT_EMAIL="boredseagulls@gmail.com"
ORG_TWITTER="bored_club"
ORG_DESCRIPTION="SeagullCash bridges liquidity on Stellar directly to liquidity pools on XRP and Hedera (HBAR), facilitating instant cross-chain payment clearing and institutional settlement."

[[PRINCIPALS]]
name="Bored Seagull Club Treasury"
email="boredseagulls@gmail.com"

# LIQUIDITY ANCHOR RAIL 1: XRPL COLLATERAL
[[CURRENCIES]]
code="SeagullCash"
name="SeagullCash"
issuer="GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7"
display_decimals=7
image="https://files.catbox.moe/w3cets.png"
is_asset_anchored=true
anchor_asset_type="crypto"
anchor_asset="XRP"
redemption_instructions="Redeemable via automated cross-chain liquidity smart contracts running on connected XRPL and Hedera bridges."
attestation_of_reserve="https://linktr.ee/boredseagullclub"
desc="SeagullCash functions as a unified ISO 20022 liquidity management asset. This token represents an operational cross-network value bridge permanently anchored between the Stellar Network, the XRP Ledger (Router: rL9qvc9KhW7fX6eYtiw8a5HUEtYzGTYZcf), and the Hedera Hashgraph Network (HTS Token: 0.0.10419620)."
conditions="There will only ever be 9,999,999,999,999 SeagullCash tokens in existence. Automated supply auditing is strictly regulated by on-chain ISO 20022 message parsers across all connected treasury gateways."

# LIQUIDITY ANCHOR RAIL 2: HEDERA HASHGRAPH COLLATERAL
[[CURRENCIES]]
code="SeagullCash"
name="SeagullCash"
issuer="GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7"
display_decimals=7
image="https://files.catbox.moe/w3cets.png"
is_asset_anchored=true
anchor_asset_type="crypto"
anchor_asset="HBAR"
redemption_instructions="Redeemable via automated cross-chain liquidity smart contracts running on connected XRPL and Hedera bridges."
attestation_of_reserve="https://linktr.ee/boredseagullclub"
desc="SeagullCash functions as a unified ISO 20022 liquidity management asset. This token represents an operational cross-network value bridge permanently anchored between the Stellar Network, the XRP Ledger (Router: rL9qvc9KhW7fX6eYtiw8a5HUEtYzGTYZcf), and the Hedera Hashgraph Network (HTS Token: 0.0.10419620)."
conditions="There will only ever be 9,999,999,999,999 SeagullCash tokens in existence. Automated supply auditing is strictly regulated by on-chain ISO 20022 message parsers across all connected treasury gateways."`;

    return res.send(anchoredTomlData);
});



//// 🔍 GET USER PROFILE (Intelligently queries either 'users' or 'agents')
//// 🔍 GET USER PROFILE (Intelligently queries either 'users' or 'agents')
app.get('/api/user/profile', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ success: false, error: "MISSING_ADDRESS_ID" });
    }

    let activeDb = req.app.locals.db || (typeof db !== 'undefined' ? db : null);
    if (!activeDb && mongoose.connection && mongoose.connection.db) {
      activeDb = mongoose.connection.db;
    }

    if (!activeDb) {
      return res.status(500).json({ success: false, error: "DATABASE_NOT_INITIALIZED" });
    }

    const formattedId = id.trim();
    const isEvm = formattedId.startsWith('0x');

    let record = null;

    if (isEvm) {
      // 🦅 Queries 'users' via 'walletAddress' matching the exact casing used in submit/database test
      record = await activeDb.collection('users').findOne({ walletAddress: formattedId });
    } else {
      record = await activeDb.collection('agents').findOne({ seagullNetId: formattedId });
    }

    if (!record) {
      return res.json({
        success: true,
        kycStatus: "TIER_0_UNVERIFIED"
      });
    }

    // 🦅 Pull status directly from root level and name from the operator sub-object
    const resolvedStatus = record.kycStatus || "TIER_0_UNVERIFIED";
    const resolvedName = (record.operator && record.operator.fullName) || record.fullName || "";

    res.json({
      success: true,
      kycStatus: resolvedStatus,
      fullName: resolvedName,
      user: {
        kycStatus: resolvedStatus,
        fullName: resolvedName
      }
    });

  } catch (error) {
    console.error("Fetch User Profile Error:", error);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});




// 🛡️ USER KYC SUBMISSION (Saves directly to user wallet address)
app.post('/api/user/kyc/submit', upload.any(), async (req, res) => {
  try {
    const uploadedFile = req.file || (req.files && req.files[0]);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: "MISSING_DOCUMENT_UPLOAD" });
    }

    const {
      walletAddress, // 👈 e.g., 0x870f64e73e7d2dc5022b4b74e58c323b3148a984
      fullName,
      dateOfBirth,
      country,
      documentType,
      documentNumber,
      targetTier
    } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ success: false, error: "MISSING_WALLET_ADDRESS" });
    }

    let activeDb = req.app.locals.db || (typeof db !== 'undefined' ? db : null);
    if (!activeDb && mongoose.connection && mongoose.connection.db) {
      activeDb = mongoose.connection.db;
    }

    if (!activeDb) {
      return res.status(500).json({ success: false, error: "DATABASE_NOT_INITIALIZED" });
    }

        // 🦅 --- AWS FACE SCAN START ---
    const fs = require('fs');

    // Safely extract properties, handling both single and array structures
    const originalName = uploadedFile.originalname || (uploadedFile.name) || "";
    const mimeType = uploadedFile.mimetype || (uploadedFile.type) || "";

    const isImageFile = /\.(jpg|jpeg|png)$/i.test(originalName) || mimeType.startsWith('image/');

    if (isImageFile) {
      try {
        const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");
        const rekognition = new RekognitionClient({ region: "us-east-1" });
        const command = new DetectFacesCommand({
          Image: { Bytes: fs.readFileSync(uploadedFile.path) },
          Attributes: ["DEFAULT"]
        });
        const data = await rekognition.send(command);

        if (!data.FaceDetails || data.FaceDetails.length === 0) {
          if (fs.existsSync(uploadedFile.path)) {
            fs.unlinkSync(uploadedFile.path);
          }
          return res.status(400).json({
            success: false,
            error: "INVALID_DOCUMENT_IMAGE",
            message: "Face verification failed. Please ensure your face is clearly visible on the ID document."
          });
        }
            } catch (awsError) {
        console.error("AWS Rekognition error:", awsError);

        if (fs.existsSync(uploadedFile.path)) {
          fs.unlinkSync(uploadedFile.path);
        }
        return res.status(400).json({
          success: false,
          error: "FACE_SCAN_SERVICE_ERROR",
          message: awsError.message || "Could not process document image."
        });
      }

    } else {
      // If they uploaded something that isn't an image at all, block it.
      if (fs.existsSync(uploadedFile.path)) {
        fs.unlinkSync(uploadedFile.path);
      }
      return res.status(400).json({
        success: false,
        error: "INVALID_FILE_TYPE",
        message: "Only JPG, JPEG, and PNG images are supported."
      });
    }
    // 🦅 --- AWS FACE SCAN END ---


    const assignedStatus = (targetTier === "TIER_2_INSTITUTIONAL") ? "TIER_2_INSTITUTIONAL" : "TIER_1_VERIFIED";
    const cleanAddress = walletAddress.trim(); // 👈 Keep the original casing that worked in your test!

    // Update or create the User record directly by wallet address
    await activeDb.collection('users').updateOne(
      { walletAddress: cleanAddress }, // Query key
      {
        $set: {
          walletAddress: cleanAddress,   // Ensure this field is explicitly written
          publicAddress: cleanAddress,   // 🦅 Populates unique index field to prevent Mongo E11000 null errors!
          kycStatus: assignedStatus,
          fullName: fullName.trim(),
          dateOfBirth: dateOfBirth,
          country: country.trim(),
          document: {
            type: documentType,
            number: documentNumber.trim(),
            fileName: uploadedFile.filename,
            filePath: uploadedFile.path,
            uploadedAt: new Date()
          },
          updatedAt: new Date()
        }
      },
      { upsert: true } // Creates the document if the user doesn't exist yet!
    );

    res.json({
      success: true,
      kycStatus: assignedStatus,
      message: `Identity successfully upgraded to ${assignedStatus}!`
    });

  } catch (error) {
    console.error("User KYC Submit Error:", error);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

// 🦅 THE AI AGENT MANIFEST: Gated securely behind agent token validation
app.get('/api/agent/manifest', authenticateJWT, (req, res) => {
  res.json({
    protocol: "SEAGULL_SOVEREIGN_GATEWAY",
    version: "2.0",
    authentication: {
      mechanism: "JWT",
      placement: "Header: Authorization",
      format: "Bearer <YOUR_JWT_TOKEN>"
    },
    schemas: {
      intent: {
        method: "POST",
        path: "/api/bridge/intent",
        description: "Generates a sovereign bridge ticket and custom memo for tracking network deposits.",
        required_body: {
          amount: "Number (The raw volume to be moved)",
          symbol: "String (SGC | SGH | NATIVE)",
          fromChain: "String (XRPL | STELLAR | HEDERA | XDC | FLARE)",
          toChain: "String (XRPL | STELLAR | HEDERA | XDC | FLARE)",
          destinationAddress: "String (Target ledger public address)",
          userId: "String (EVM Wallet Address or assigned SeagullNetId)"
        }
      },
      broadcast: {
        method: "POST",
        path: "/api/wallet/broadcast",
        description: "Transmits raw multi-chain signed signatures to native ledgers and generates ISO-20022 logs.",
        required_body: {
          chain: "String (XRPL | STELLAR | HEDERA | XDC | FLARE)",
          signedBlob: "String (Hex signature or Stellar XDR Base64 payload string)",
          amount: "String (Numeric representation of the asset volume)",
          asset: "String (SGCN | SGCSH | NATIVE)",
          recipient: "String (Target receiver address)",
          memo: "String (The tracking ticket index number mapped from the intent schema)"
        }
      }
    }
  });
});



// 🦅 THE AI AGENT HANDSHAKE (Add this to app.js)
app.post('/api/agent/handshake', async (req, res) => {
  try {
    const { walletAddress, name } = req.body;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "REGISTRATION_REQUIRED",
        message: "You must provide a 'walletAddress' to register with the Seagull Sovereign Gateway."
      });
    }

    // 🦅 THE BULLETPROOF DB RESOLVER
    // We check req.app.locals.db first, then fall back to global db.
    // If BOTH are undefined because of boot order, we grab it directly from the mongoose connection.
    let activeDb = req.app.locals.db || (typeof db !== 'undefined' ? db : null);

    if (!activeDb) {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.db) {
        activeDb = mongoose.connection.db;
      }
    }

    if (!activeDb) {
      console.error("Handshake Error: Database instance not ready.");
      return res.status(500).json({ success: false, error: "DATABASE_NOT_INITIALIZED" });
    }

    // Look up or Register the Agent
    let agent = await activeDb.collection('agents').findOne({ walletAddress: walletAddress.trim() });

    if (!agent) {
      const newAgentNumber = Math.floor(1000 + Math.random() * 9000);
      const generatedNetId = `SGN-ID-${newAgentNumber}`;

      agent = {
        seagullNetId: generatedNetId,
        walletAddress: walletAddress.trim(),
        name: name ? name.trim() : `Agent_${newAgentNumber}`,
        createdAt: new Date(),
        lastHandshakeAt: new Date(),
        kycStatus: "TIER_0_UNVERIFIED",
        dailyLimitSeagullCoin: 10000,       // Baseline Public SGC Limit
        dailyLimitSeagullCash: 1000000,     // Baseline Public SGCASH Limit
        isBlocked: false
      };

      await activeDb.collection('agents').insertOne(agent);
    } else {
      if (agent.isBlocked) {
        return res.status(403).json({
          success: false,
          error: "AGENT_BLOCKED",
          message: "This Seagull Net ID has been suspended from the gateway."
        });
      }

      await activeDb.collection('agents').updateOne(
        { walletAddress: walletAddress.trim() },
        { $set: { lastHandshakeAt: new Date() } }
      );
    }

    // 🦅 LINE TO ADD: Generate a machine-session token locking down their wallet address and role
    const agentToken = jwt.sign(
      { id: agent.seagullNetId, walletAddress: agent.walletAddress, role: 'agent' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token: agentToken, // 🦅 ADD THIS LINE: Pass the secure machine token back to the agent
      registration: {
        seagullNetId: agent.seagullNetId,
        kycStatus: agent.kycStatus,
        dailyLimitSeagullCoin: agent.dailyLimitSeagullCoin || 10000,
        dailyLimitSeagullCash: agent.dailyLimitSeagullCash || 1000000,
        registeredName: agent.name
      },
      protocol: "SEAGULL_SOVEREIGN_GATEWAY",
      version: "2.0",
      capabilities: {
        assets: ["SEAGULLCOIN", "SEAGULLCASH"],
        standards: ["ISO-20022", "PACS.008"],
        chains: ["XRPL", "STELLAR", "HEDERA", "XDC", "FLARE"]
      },
      endpoints: {
        manifest: "/api/agent/manifest", // 🦅 ADD THIS LINE: Connect the machine roadmap
        intent: "/api/bridge/intent",
        payout: "/api/wallet/broadcast",
        archive: "/api/iso-terminal"
      }
    });

  } catch (error) {
    console.error("Agent Handshake Error:", error);
    res.status(500).json({ success: false, error: "GATEWAY_HANDSHAKE_ERROR" });
  }
});

// 🛡️ UNIFIED KYC SUBMISSION (Auto-detects EVM Wallets vs AI Agents)
app.post('/api/kyc/submit', upload.any(), async (req, res) => {
  try {
    const uploadedFile = req.file || (req.files && req.files[0]);
    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: "MISSING_DOCUMENT_UPLOAD" });
    }

    const {
      identifier, // 👈 Send whatever the connected address/ID is (0x... or SGN-ID-...)
      fullName,
      dateOfBirth,
      country,
      documentType,
      documentNumber,
      globalTaxIdOrSsn,
      passkeyPublicKey,
      targetTier
    } = req.body;

    if (!identifier) {
      return res.status(400).json({ success: false, error: "MISSING_IDENTIFIER" });
    }

    // 🦅 Resolving Active DB
    let activeDb = req.app.locals.db || (typeof db !== 'undefined' ? db : null);
    if (!activeDb && mongoose.connection && mongoose.connection.db) {
      activeDb = mongoose.connection.db;
    }

    if (!activeDb) {
      return res.status(500).json({ success: false, error: "DATABASE_NOT_INITIALIZED" });
    }

        // 🦅 --- AWS FACE SCAN START ---
    const fs = require('fs');

    // Check BOTH the original file extension AND the mimetype to be 100% sure it's an image
    const isImageFile = /\.(jpg|jpeg|png)$/i.test(uploadedFile.originalname) ||
                        (uploadedFile.mimetype && uploadedFile.mimetype.startsWith('image/'));

    if (isImageFile) {
      try {
        const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");
        const rekognition = new RekognitionClient({ region: "us-east-1" });
        const command = new DetectFacesCommand({
          Image: { Bytes: fs.readFileSync(uploadedFile.path) },
          Attributes: ["DEFAULT"]
        });
        const data = await rekognition.send(command);

        if (!data.FaceDetails || data.FaceDetails.length === 0) {
          // Delete the bad file immediately from your disk
          if (fs.existsSync(uploadedFile.path)) {
            fs.unlinkSync(uploadedFile.path);
          }
          return res.status(400).json({
            success: false,
            error: "INVALID_DOCUMENT_IMAGE",
            message: "Face verification failed. Please ensure your face is clearly visible on the ID document."
          });
        }
      } catch (awsError) {
        console.error("AWS Rekognition error:", awsError);
        // Fallback: If AWS service is offline or throws a parameter error, we proceed so the app doesn't freeze
      }
    }
    // 🦅 --- AWS FACE SCAN END ---


    const assignedStatus = (targetTier === "TIER_2_INSTITUTIONAL") ? "TIER_2_INSTITUTIONAL" : "TIER_1_VERIFIED";
    const coinLimit = (assignedStatus === "TIER_2_INSTITUTIONAL") ? 333333 : 500000;
    const cashLimit = (assignedStatus === "TIER_2_INSTITUTIONAL") ? 333333333 : 1000000000;

    const formattedId = identifier.trim();
    const isEvm = formattedId.startsWith('0x');

    // Choose the target database collection dynamically
    const targetCollection = isEvm ? 'users' : 'agents';

    // 🦅 Query and save with the EXACT SAME casing that succeeded in your manual script
    const queryFilter = isEvm ? { publicAddress: formattedId } : { seagullNetId: formattedId };
    const publicAddressVal = isEvm ? formattedId : null;
    const walletAddressVal = isEvm ? formattedId : null;

    // Update or create the record in the correct collection
    await activeDb.collection(targetCollection).updateOne(
      queryFilter,
      {
        $set: {
          publicAddress: publicAddressVal,
          walletAddress: walletAddressVal,
          kycStatus: assignedStatus,
          dailyLimitSeagullCoin: coinLimit,
          dailyLimitSeagullCash: cashLimit,
          operator: {
            fullName: fullName.trim(),
            dateOfBirth: dateOfBirth,
            country: country.trim(),
            document: {
              type: documentType,
              number: documentNumber.trim(),
              fileName: uploadedFile.filename,
              filePath: uploadedFile.path,
              uploadedAt: new Date()
            },
            globalTaxIdOrSsn: globalTaxIdOrSsn ? globalTaxIdOrSsn.trim() : null,
            passkey: passkeyPublicKey || null,
            verifiedAt: new Date()
          }
        }
      },
      { upsert: true } // Ensure it creates the user record if it doesn't exist
    );

    res.json({
      success: true,
      kycStatus: assignedStatus,
      message: `Identity successfully upgraded to ${assignedStatus}!`,
      registration: {
        identifier: formattedId,
        kycStatus: assignedStatus,
        dailyLimitSeagullCoin: coinLimit,
        dailyLimitSeagullCash: cashLimit,
        registeredName: fullName.trim()
      }
    });

  } catch (error) {
    console.error("Unified KYC Submit Error:", error);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});

app.get('/api/balances/:address', async (req, res) => {
    let { address } = req.params;

    try {
        const User = mongoose.models.User || mongoose.model('User');
        let user = await User.findOne({
            $or: [
                { publicAddress: address },
                { walletAddress: address },
                { 'wallets.evm': address },
                { 'wallets.xrpl': address },
                { 'wallets.stellar': address }
            ]
        });

        // 🦅 Try DB first, fallback to URL parameter, then fallback to Frontend Headers
        let xrplAddr = user?.wallets?.xrpl || (address.startsWith('r') ? address : null) || req.headers['x-native-xrpl'];
        let stellarAddr = user?.wallets?.stellar || (address.startsWith('G') ? address : null) || req.headers['x-native-stellar'];

        const isHederaNative = address.startsWith('0.0.');
        const evmAddr = user?.wallets?.evm || (!isHederaNative && address.startsWith('0x') ? address : null);
        const hbarAddr = isHederaNative ? address : (user?.wallets?.hedera || req.headers['x-native-hedera'] || evmAddr);


        if (user?.mnemonic && (!xrplAddr || !stellarAddr)) {
            const derived = getChainAddresses(user.mnemonic);
            if (derived) {
                xrplAddr = xrplAddr || derived.xrpl;
                stellarAddr = stellarAddr || derived.stellar;

                user.wallets = {
                    evm: evmAddr,
                    xrpl: xrplAddr,
                    stellar: stellarAddr
                };
                await user.save();
            }
        }

        // Run live search parties
        const results = await Promise.allSettled([
            xrplAddr ? fetchXRPL(xrplAddr) : Promise.resolve([]),
            stellarAddr ? fetchStellar(stellarAddr) : Promise.resolve([]),
            evmAddr ? fetchXDC(evmAddr) : Promise.resolve([]),
            evmAddr ? fetchFlare(evmAddr) : Promise.resolve([]),
            hbarAddr ? fetchHedera(hbarAddr) : Promise.resolve([])
        ]);

        const chains = ['XRPL', 'XLM', 'XDC', 'FLARE', 'HBAR'];

        const allBalances = chains.map((currentChain, index) => {
            const r = results[index];
            let items = (r && r.status === 'fulfilled') ? (r.value || []) : [];

            const fallbacks = [];

            // 🦅 COMPATIBILITY MATCHING Layer
            if (index === 0 && xrplAddr) {
                fallbacks.push(
                    { symbol: 'XRP', balance: '0.00' },
                    { symbol: 'SEAGULLCASH', balance: '0.00' },
                    { symbol: 'SEAGULLCOIN', balance: '0.00' }
                );
            }
            if (index === 1 && stellarAddr) {
                fallbacks.push(
                    { symbol: 'XLM', balance: '0.00' },
                    { symbol: 'SEAGULLCASH', balance: '0.00' }
                );
            }
            if (index === 2 && evmAddr) {
                fallbacks.push(
                    { symbol: 'XDC', balance: '0.00' },
                    { symbol: 'SGC', balance: '0.00' } 
                );
            }
            if (index === 3 && evmAddr) {
                fallbacks.push(
                    { symbol: 'FLR', balance: '0.00' },
                    { symbol: 'SGC', balance: '0.00' } 
                );
            }
            if (index === 4 && hbarAddr) {
                fallbacks.push(
                    { symbol: 'HBAR', balance: '0.00' },
                    { symbol: 'SGCSH', balance: '0.00' }
                );
            }

            const combinedItems = [...items, ...fallbacks];
            const uniqueItems = [];
            const seenSymbols = new Set();

            for (const item of combinedItems) {
                let matchKey = (item.symbol || '').toUpperCase().trim();

                if (!seenSymbols.has(matchKey)) {
                    seenSymbols.add(matchKey);
                    uniqueItems.push(item);
                }
            }

            return uniqueItems.map(item => {
                const updatedItem = { ...item };
                updatedItem.chain = currentChain;

                if (!updatedItem.address) {                                                                                                                                   
                    if (index === 0) updatedItem.address = xrplAddr;
                    else if (index === 1) updatedItem.address = stellarAddr;
                    else if (index === 4) updatedItem.address = hbarAddr;
                    else updatedItem.address = evmAddr;
                }

                return updatedItem;
            });
        }).flat();

        res.json(allBalances);

    } catch (err) {
        console.error("Radar Error:", err.message);
        res.status(500).json({ error: "Radar mapping failed" });
    }
});



app.get('/api/iso-terminal', async (req, res) => {
    try {
        const db = mongoose.connection.db;

        // 1. Concurrent Fetch - Pull both historical sets
        const [oldMessages, newMessages] = await Promise.all([
            db.collection('isomessages').find().sort({createdAt: -1}).toArray(),
            db.collection('iso_messages').find().sort({timestamp: -1}).toArray()
        ]);

        // Helper function to format a raw hash/ID safely as a compliant 36-char UETR UUIDv4
        const formatToUetr = (hash) => {
            if (!hash) return "00000000-0000-4000-a000-000000000000";
            const clean = hash.replace(/[^a-fA-F0-9]/g, '');
            if (clean.length < 32) return "00000000-0000-4000-a000-" + clean.padEnd(12, '0').slice(0, 12);
            return `${clean.slice(0,8)}-${clean.slice(8,12)}-4${clean.slice(13,16)}-${(parseInt(clean.slice(16,17), 16) & 0x3 | 0x8).toString(16)}${clean.slice(17,20)}-${clean.slice(20,32)}`;
        };

        // 2. Map old messages (isomessages)
        const mappedOld = oldMessages.map(msg => {
            let extractedAmount = "0.0000000";
            if (msg.rawXml) {
                const amtMatch = msg.rawXml.match(/<IntrBkSttlmAmt[^>]*>([^<]+)<\/IntrBkSttlmAmt>/);
                if (amtMatch && amtMatch[1]) {
                    extractedAmount = amtMatch[1];
                }
            }

            let extractedCurrency = "SEAGULLCASH";
            if (msg.rawXml) {
                const ccyMatch = msg.rawXml.match(/Ccy="([^"]+)"/);
                if (ccyMatch && ccyMatch[1]) {
                    extractedCurrency = ccyMatch[1];
                }
            }

            const txHash = msg.txHash || msg._id.toString();
            const network = msg.chain || 'XRPL';
            const endToEndId = msg.endToEndId || 'NO_REF';
            const uetr = formatToUetr(txHash);
            const timestamp = msg.createdAt || new Date();

            // SWIFT Standard compliant pacs.008.001.08 XML
            const xml = msg.rawXml || `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>SGC-MSG-${txHash.slice(0, 12).toUpperCase()}</MsgId>
      <CreDtTm>${new Date(timestamp).toISOString()}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>IND</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>INSTR-${txHash.slice(0, 12).toUpperCase()}</InstrId>
        <EndToEndId>${endToEndId}</EndToEndId>
        <UETR>${uetr}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${extractedCurrency}">${extractedAmount}</IntrBkSttlmAmt>
      <InstgAgt>
        <FinInstnId>
          <Nm>SEAGULL_PROTOCOL_NODE</Nm>
        </FinInstnId>
      </InstgAgt>
      <Dbtr>
        <Nm>${msg.debtor?.name || 'SEAGULL_LIQUIDITY_POOL'}</Nm>
      </Dbtr>
      <Cdtr>
        <Nm>${msg.creditor?.name || 'EXTERNAL_RECIPIENT_WALLET'}</Nm>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

            return {
                id: msg._id,
                uetr: txHash,
                type: 'pacs.008.001.08',
                amount: extractedAmount,
                currency: extractedCurrency,
                sender: msg.debtor?.agent || 'XLM',
                receiver: network,
                timestamp: msg.createdAt,
                rawXml: xml
            };
        });

        // 3. Map new messages (iso_messages)
        const mappedNew = newMessages.map(msg => {
            const txHash = msg.uetr || msg._id.toString();
            const amount = msg.amount || msg.instructedAmount || "0.0000000";
            const currency = msg.currency || "SEAGULLCASH";

            const senderNetwork = msg.sender || 'XLM';
            const receiverNetwork = msg.receiver || 'XRPL';
            const endToEndId = msg.endToEndId || 'NO_REF';
            const uetr = formatToUetr(txHash);
            const timestamp = msg.timestamp || new Date();

            // SWIFT Standard compliant pacs.008.001.08 XML
            const xml = msg.rawXml || `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>SGC-MSG-${txHash.slice(0, 12).toUpperCase()}</MsgId>
      <CreDtTm>${new Date(timestamp).toISOString()}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>IND</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>INSTR-${txHash.slice(0, 12).toUpperCase()}</InstrId>
        <EndToEndId>${endToEndId}</EndToEndId>
        <UETR>${uetr}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${currency}">${amount}</IntrBkSttlmAmt>
      <InstgAgt>
        <FinInstnId>
          <Nm>SEAGULL_PROTOCOL_NODE</Nm>
        </FinInstnId>
      </InstgAgt>
      <Dbtr>
        <Nm>${senderNetwork}_BRIDGE_VAULT</Nm>
      </Dbtr>
      <Cdtr>
        <Nm>${receiverNetwork}_BRIDGE_VAULT</Nm>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

            return {
                id: msg._id,
                uetr: txHash,
                type: 'pacs.008.001.08',
                amount: amount,
                currency: currency,
                sender: senderNetwork,
                receiver: receiverNetwork,
                timestamp: msg.timestamp,
                rawXml: xml
            };
        });

        // 4. Combine and Sort Chronologically by the correct record dates
        const combined = [
            ...mappedOld.map(m => ({ ...m, sortDate: new Date(m.timestamp) })),
            ...mappedNew.map(m => ({ ...m, sortDate: new Date(m.timestamp) }))
        ];

        const sortedData = combined
            .sort((a, b) => b.sortDate - a.sortDate)
            .map(({ sortDate, ...rest }) => rest)
            .slice(0, 100);

        res.json(sortedData);
    } catch (err) {
        console.error("❌ ISO Terminal Sync Error:", err);
        res.status(500).json({ error: "Failed to sync professional-grade terminal" });
    }
});

// 🛡️ INSTITUTIONAL / CORPORATE KYC SUBMISSION (Multi-part for ID uploads)
// 🛡️ INSTITUTIONAL / CORPORATE KYC SUBMISSION (Multi-part for ID uploads)
   // 🛡️ INSTITUTIONAL / CORPORATE KYC SUBMISSION (Multi-part for ID uploads)
app.post('/api/agent/kyc/submit', upload.any(), async (req, res) => {
  try {
    // 🔍 Handle either single file format or array format dynamically
    const uploadedFile = req.file || (req.files && req.files[0]);

    if (!uploadedFile) {
      return res.status(400).json({ success: false, error: "MISSING_DOCUMENT_UPLOAD" });
    }

    const {
      seagullNetId,
      fullName,
      dateOfBirth,
      country,
      documentType,
      documentNumber,
      globalTaxIdOrSsn,
      passkeyPublicKey,
      targetTier // 👥 Received from the modal parameters
    } = req.body;

    // 🦅 THE BULLETPROOF DB RESOLVER
    let activeDb = req.app.locals.db || (typeof db !== 'undefined' ? db : null);

    if (!activeDb) {
      const mongoose = require('mongoose');
      if (mongoose.connection && mongoose.connection.db) {
        activeDb = mongoose.connection.db;
      }
    }

    if (!activeDb) {
      console.error("KYC Submit Error: Database instance not ready.");
      return res.status(500).json({ success: false, error: "DATABASE_NOT_INITIALIZED" });
    }

    // Determine target status and limits
    const assignedStatus = (targetTier === "TIER_2_INSTITUTIONAL") ? "TIER_2_INSTITUTIONAL" : "TIER_1_VERIFIED";
    const coinLimit = (assignedStatus === "TIER_2_INSTITUTIONAL") ? 333333 : 500000;
    const cashLimit = (assignedStatus === "TIER_2_INSTITUTIONAL") ? 333333333 : 1000000000;

    // Update the Agent Record in MongoDB
    await activeDb.collection('agents').updateOne(
      { seagullNetId: seagullNetId },
      {
        $set: {
          kycStatus: assignedStatus,
          dailyLimitSeagullCoin: coinLimit,
          dailyLimitSeagullCash: cashLimit,
          operator: {
            fullName: fullName.trim(),
            dateOfBirth: dateOfBirth,
            country: country.trim(),
            document: {
              type: documentType,
              number: documentNumber.trim(),
              fileName: uploadedFile.filename, // 🔍 Updated to use uploadedFile
              filePath: uploadedFile.path,     // 🔍 Updated to use uploadedFile
              uploadedAt: new Date()
            },
            globalTaxIdOrSsn: globalTaxIdOrSsn ? globalTaxIdOrSsn.trim() : null,
            passkey: passkeyPublicKey || null,
            verifiedAt: new Date()
          }
        }
      }
    );

    res.json({
      success: true,
      message: `Identity successfully upgraded to ${assignedStatus}!`,
      registration: {
        seagullNetId: seagullNetId,
        kycStatus: assignedStatus,
        dailyLimitSeagullCoin: coinLimit,
        dailyLimitSeagullCash: cashLimit,
        registeredName: fullName.trim()
      }
    });

  } catch (error) {
    console.error("KYC Submit Error:", error);
    res.status(500).json({ success: false, error: "INTERNAL_SERVER_ERROR" });
  }
});
;


// ACTIVE AGENT PROFILE STATUS
// ACTIVE AGENT PROFILE STATUS
app.get('/api/agent/profile', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ success: false, error: "MISSING_AGENT_ID" });
    }

    const db = mongoose.connection.db;
    const agent = await db.collection('agents').findOne({ seagullNetId: id });

    if (!agent) {
      return res.status(404).json({ success: false, error: "AGENT_NOT_FOUND" });
    }

    // Determine limits dynamically based on their actual KYC Status
    let coinLimit = 10000;       // Tier 0 Default SGC
    let cashLimit = 1000000;     // Tier 0 Default SGCASH
    const status = agent.kycStatus || "TIER_0_UNVERIFIED";

    if (status === "TIER_1_VERIFIED") {
      // 👑 Tier 1: Sovereign Agents strictly get 500k SGC and 1 Billion SGCASH (Overrides older DB values)
      coinLimit = 500000;
      cashLimit = 1000000000;
    } else if (status === "TIER_2_INSTITUTIONAL") {
      // 👥 Tier 2: Verified Public strictly gets 333,333 SGC and 333,333,333 SGCASH
      coinLimit = 333333;
      cashLimit = 333333333;
    }

    // Return the persistent verification state and native token limits directly from MongoDB
    res.json({
      success: true,
      kycStatus: status,
      dailyLimitSeagullCoin: coinLimit,
      dailyLimitSeagullCash: cashLimit,
      operator: agent.operator || null
    });

  } catch (error) {
    console.error("Profile Fetch Error:", error);
        res.status(500).json({ success: false, error: "INTERNAL_ERROR" });
  }
});

app.get('/api/explorer/scout/:address', async (req, res) => {
    try {
        const { address } = req.params;
        if (!address) return res.status(400).json({ success: false, error: 'Target identity missing.' });

        // Trigger our hybrid microservice engine
        const unifiedDataPayload = await executeMultiChainScout(address.trim());

        // FLATTEN HERE: Send the array directly on data so the frontend map doesn't break!
        res.json({ 
            success: true, 
            data: unifiedDataPayload.identityReport,    // Flat array for the asset row loop
            richlist: unifiedDataPayload.globalMetrics  // Root-level stats for your sidebar/panels
        });

    } catch (err) {
        console.error("🔍 ULTIMATE SCOUT EXCEPTION:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});



// --- HELPER FUNCTIONS (The Search Parties) ---
// 🦅 Define these at the top of your helpers section
const SEAGULL_COIN_XDC = process.env.SEAGULL_COIN_XDC || "0xd38109F587bd0326CAd60a18CF3C1ECD546809a6";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function fetchXDC(address) {
    try {
        // FORCE the high-speed endpoint and explicitly bind the XDC Network Chain ID (50)
        const provider = new ethers.JsonRpcProvider("https://erpc.xdcrpc.com/", undefined, {
            staticNetwork: ethers.Network.from(50)
        });
        const safeAddress = ethers.getAddress(address.toLowerCase());
        const nativeBal = await provider.getBalance(safeAddress);
        
        console.log(`\n🔍 [DEBUG XDC] Address: ${safeAddress}`);
        console.log(`   Forced Network Native BigInt: ${nativeBal.toString()}`);

        const assets = [{
            name: 'XDC Network',
            balance: ethers.formatEther(nativeBal),
            symbol: 'XDC',
            logo: '/assets/xdc.png'
        }];

        if (SEAGULL_COIN_XDC) {
            const safeContract = ethers.getAddress(SEAGULL_COIN_XDC.toLowerCase());
            const contract = new ethers.Contract(safeContract, ERC20_ABI, provider);                                
            const tokenBal = await contract.balanceOf(safeAddress);                                             
            
            console.log(`   Forced Network SGC Token BigInt: ${tokenBal.toString()}`);

            if (tokenBal > 0n) {                                                                                             
                assets.push({                                                                                                   
                    name: 'SeagullCoin (XDC)',
                    balance: ethers.formatUnits(tokenBal, 18), 
                    symbol: 'SGC',                                                                                              
                    logo: '/assets/sgc.webp'
                });
            }
        }
        return assets;                                                                                          
    } catch (e) {                                                                                                   
        console.log("🔴 XDC/SGC Fetch Critical Exception:", e.message);                                                             
        return [];                                                                                              
    }                                                                                                       
}

async function fetchFlare(address) {
    try {
        // FORCE the premium endpoint and explicitly bind the Flare Network Chain ID (14)
        const provider = new ethers.JsonRpcProvider("https://rpc.ankr.com/flare", undefined, {
            staticNetwork: ethers.Network.from(14)
        });                                                                                                      
        const safeAddress = ethers.getAddress(address.toLowerCase());
        const nativeBal = await provider.getBalance(safeAddress);
        
        console.log(`\n🔍 [DEBUG FLARE] Address: ${safeAddress}`);
        console.log(`   Forced Network Native BigInt: ${nativeBal.toString()}`);

        let assets = [{
            name: 'Flare Network',                                                                                      
            balance: ethers.formatEther(nativeBal),
            symbol: 'FLR',                                                                                              
            logo: '/assets/flr.png'
        }];
        
        const sgcFlareAddr = process.env.SEAGULL_COIN_FLR;
        if (sgcFlareAddr) {                                                                                             
            const safeContract = ethers.getAddress(sgcFlareAddr.toLowerCase());
            const contract = new ethers.Contract(safeContract, ["function balanceOf(address) view returns (uint256)"], provider);                                                                                                   
            const tokenBal = await contract.balanceOf(safeAddress);
            
            console.log(`   Forced Network SGC Token BigInt: ${tokenBal.toString()}`);

            if (tokenBal > 0n) {                                                                                             
                assets.push({
                    name: 'SeagullCoin (FLR)',                                                                                  
                    balance: ethers.formatUnits(tokenBal, 18),
                    symbol: 'SGC',                                                                                             
                    logo: '/assets/sgc.webp'
                });                                                                                                     
            }
        }
        return assets;
    } catch (e) { 
        console.log("🔴 Flare/SGC Fetch Critical Exception:", e.message);
        return []; 
    }
}




// 🦅 THE UNIFIED ISO TRANSLATOR
const getChainAddresses = (mnemonic) => {
    try {
        // 1. XRPL (Standard r-address)
        const xrplWallet = xrpl.Wallet.fromMnemonic(mnemonic);

        // 2. Stellar (Standard SEP-0005 G-address)
        const seed = bip39.mnemonicToSeedSync(mnemonic);
        const stellarSeed = derivePath("m/44'/148'/0'", seed.toString('hex')).key;
        const stellarKeypair = StellarSdk.Keypair.fromRawEd25519Seed(stellarSeed);

        // 3. EVM (Standard 0x address)
        // We use ethers to get a real 0x address from the same mnemonic
        const evmWallet = ethers.Wallet.fromPhrase(mnemonic);

        return {
            evm: evmWallet.address,     // Properly starts with 0x
            xrpl: xrplWallet.address,   // Properly starts with r
            stellar: stellarKeypair.publicKey() // Properly starts with G
        };
    } catch (e) {
        console.error("Translation Error:", e.message);
        return null;
    }
};

async function fetchStellar(address) {
    if (!address || !address.startsWith('G')) return [];

    // 🦅 Official Sovereign Issuer
    const SGH_ISSUER = "GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7";

    try {
        const response = await axios.get(`https://horizon.stellar.org/accounts/${address}`);
        // Horizon returns an array of balances (native and credit_alphanum4/12)
        return response.data.balances.map(b => {
            const isNative = b.asset_type === 'native';
            const symbol = isNative ? 'XLM' : b.asset_code;

            // 🦅 The Match: Symbol variation + Issuer validation
            const isSGH = (
  b.asset_code === 'SEAGULLCASH' ||
  b.asset_code === 'SGH' ||
  b.asset_code === 'SGCSH'
) && b.asset_issuer === "GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7";


            return {
                name: isNative ? 'Stellar' : (isSGH ? 'SeagullCash (XLM)' : 'Stellar Asset'),
                balance: b.balance,
                symbol: symbol,
                logo: isNative ? '/assets/xlm.png' : '/assets/sgh.webp',
                address: address
            };
        });
    } catch (e) {
        // If account isn't funded or doesn't exist, return empty
        return [];
    }
}


                                                                                                            
                                                                                                            
async function fetchXRPL(address) {
    if (!address || !address.startsWith('r')) return [];
    const client = new xrpl.Client(process.env.XRPL_RPC || "wss://s2.ripple.com");
    try {
        await client.connect();
        
        // 1. Native XRP
        const accountInfo = await client.request({ command: "account_info", account: address });
        let assets = [{
            name: 'XRP Ledger',
            balance: xrpl.dropsToXrp(accountInfo.result.account_data.Balance),
            symbol: 'XRP',
            logo: '/assets/xrp.png'
        }];

        // 2. Trustlines with Dual-Issuer Validation
        const lines = await client.request({ command: "account_lines", account: address });
        
        // 🦅 THE SOVEREIGN MAP                                                                                                                
        const ISSUERS = {  
            SGCN: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno", 
            SGCSH: "rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK"  
        };                                                                                                                                    
        
        // 🦅 THE EXACT HEX COINS FROM THE LEDGER                                                                                           
        const HEX_MAP = {
            "53656167756C6C436F696E000000000000000000": { name: "SeagullCoin", symbol: "SGCN", logo: "/assets/sgc.webp" },
            "53656167756C6C43617368000000000000000000": { name: "SeagullCash", symbol: "SGCSH", logo: "/assets/sgh.webp" },
        };

        lines.result.lines.forEach(line => {
            const assetData = HEX_MAP[line.currency];
            if (assetData) {
                assets.push({
                    name: assetData.name,                                         
                    balance: parseFloat(line.balance).toString(),
                    symbol: assetData.symbol,                                               
                    logo: assetData.logo,
                    issuer: line.account
                });
            }
        }); // <-- Close the forEach cleanly here!

        await client.disconnect();
        return assets;

    } catch (e) {
        if (client.isConnected()) await client.disconnect();
        return [];
    }
}
   

async function fetchHedera(address) {
    try {
        // This hits the mirror node which handles both HBAR and HTS Tokens
        const url = `https://mainnet-public.mirrornode.hedera.com/api/v1/accounts/${address}`;
        const response = await axios.get(url);
        const data = response.data;

        let assets = [{                                                                                                 
            name: 'Hedera',
            balance: (data.balance.balance / 100000000).toFixed(2),                                                     
            symbol: 'HBAR',
            logo: '/assets/hbar.png'
        }];

        // 🦅 THE SEAGULL CASH PROBE (Hedera)
        const targetTokenId = process.env.SEAGULL_CASH_HBAR;
        if (targetTokenId && data.balance.tokens) {
            const tokenData = data.balance.tokens.find(t => t.token_id === targetTokenId);
            if (tokenData) {                                                                                                
                assets.push({
                    name: 'SeagullCash',
                    balance: (tokenData.balance / 1000000).toFixed(2), // Adjust decimals if not 8
                    symbol: 'SGCSH',
                    logo: '/assets/sgh.webp'
                });
            }
        }

        return assets;
    } catch (e) {
        console.log("Hedera/SGH Fetch Error:", e.message);
        return []; 
    }
}



// 🦅 THE MULTI-CHAIN PAYOUT ENGINE + ISO 20022 UNIFIED ARCHIVAL ENGINE
app.post('/api/wallet/broadcast', async (req, res) => {
    // 🦅 1. BLOCK-ISOLATED EXTRACTION: Prevent local scoping variables from leaking or resetting
    const incomingChain = String(req.body.chain || '').toUpperCase().trim();
    const incomingAmount = String(req.body.amount || '0').trim();
    const incomingAsset = String(req.body.asset || '').toUpperCase().trim();
    const incomingRecipient = String(req.body.recipient || '').trim();
    const incomingMemo = String(req.body.memo || '').trim();
    const incomingType = req.body.type;
    const incomingBlob = req.body.signedBlob;

    const results = [];

    try {
        console.log(`📥 PROCESSING ${incomingChain} ${incomingType || 'BLOB'} BATCH FOR MEMO: ${incomingMemo || 'NONE'}...`);

        // 🦅 2. THE NATIVE SDK KERNEL (Bypass the blob loop for Native HBAR)
        if (incomingChain === 'HBAR' && incomingType === 'NATIVE_SDK') {

            const rawEnvKey = process.env.HBAR_KEY;
            console.log("🔍 DEBUG: HBAR_KEY Type is:", typeof rawEnvKey);

            let cleanKey = String(rawEnvKey).trim();
            if (cleanKey.startsWith('0x')) cleanKey = cleanKey.slice(2);

            // 🦅 Modern Hedera SDK explicit key initialization (Silences the warning!)
            const operatorKey = PrivateKey.fromStringECDSA(cleanKey);


            const cleanHbarId = process.env.HBAR_OPERATOR_ID ? String(process.env.HBAR_OPERATOR_ID).trim() : "0.0.10419620";

            const parsedOperatorId = cleanHbarId.startsWith("0x")
                ? AccountId.fromSolidityAddress(cleanHbarId)
                : AccountId.fromString(cleanHbarId);

            const client = Client.forMainnet().setOperator(parsedOperatorId, operatorKey);
            let transaction = new TransferTransaction();

            if (incomingAsset === 'HBAR' || incomingAsset === 'NATIVE') {
                transaction
                    .addHbarTransfer(parsedOperatorId, new Hbar(incomingAmount).negated())
                    .addHbarTransfer(String(incomingRecipient).trim(), new Hbar(incomingAmount))
                    .setTransactionMemo(incomingMemo || "");
            } else {
                const targetTokenStr = process.env.SEAGULL_CASH_HBAR
                    ? String(process.env.SEAGULL_CASH_HBAR).trim()
                    : "0.0.3115556";

                const tokenId = targetTokenStr.startsWith("0x")
                    ? TokenId.fromSolidityAddress(targetTokenStr)
                    : TokenId.fromString(targetTokenStr);

                                // 🦅 Convert the text string to a number and shift 6 decimals over for SeagullCash
                const rawAmount = Math.round(parseFloat(incomingAmount) * 1000000);

                transaction
                    .addTokenTransfer(tokenId, parsedOperatorId, -rawAmount)
                    .addTokenTransfer(tokenId, String(incomingRecipient).trim(), rawAmount)
                    .setTransactionMemo(incomingMemo || "");

            }

            const response = await transaction.execute(client);
            const receipt = await response.getReceipt(client);                                                                          
            results.push(response.transactionId ? response.transactionId.toString() : 'HBAR_NATIVE_SUCCESS');
            console.log(`✅ HBAR Native SDK Success: ${results[0]}`);

        } else {
            // 🦅 3. FIXED BLOB LOGIC (Checks format safely before jumping into the loop)
            if (!incomingBlob) {
                return res.status(400).json({ success: false, error: "Missing signedBlob payload data" });
            }

            const blobs = Array.isArray(incomingBlob) ? incomingBlob : [incomingBlob];

            for (let blob of blobs) {
                let txHash;
                if (incomingChain === 'XRPL') {
                    const client = new xrpl.Client("wss://xrplcluster.com");
                    await client.connect();
                    const result = await client.request({ command: "submit", tx_blob: blob });
                    txHash = result.result.tx_json.hash;
                    await client.disconnect();
                }

                else if (incomingChain === 'XLM') {
                    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");
                    const transaction = StellarSdk.TransactionBuilder.fromXDR(blob, StellarSdk.Networks.PUBLIC);
                    const result = await server.submitTransaction(transaction);                                                 
                    txHash = result.hash;
                }

                else if (['FLARE', 'XDC', 'HBAR', 'FLR'].includes(incomingChain)) {
                    const RPC_URLS = {
                        'FLARE': 'https://flare-api.flare.network/ext/C/rpc',
                        'FLR':   'https://flare-api.flare.network/ext/C/rpc',
                        'XDC':   'https://arpc.xinfin.network/',
                        'HBAR':  'https://mainnet.hashio.io/v1'
                    };
                    const provider = new ethers.JsonRpcProvider(RPC_URLS[incomingChain]);                                       
                    const txResponse = await provider.broadcastTransaction(blob);
                    txHash = txResponse.hash;
                }
                results.push(txHash);        
            }
        }

        // 🏛️ UNIFIED ISO 20022 TERMINAL GENERATION (Runs for ALL successful transmissions)
        try {                                                                                                           
            const finalTxHash = results[0] || 'GENERIC_HASH_ERR';

            // 🦅 ASSET DICTIONARY: Explicit mapping that checks all variations from walletRows
            let currencySymbol = 'SEAGULLCASH';
            if (['NATIVE', incomingChain, 'XRP', 'XLM', 'FLR', 'XDC'].includes(incomingAsset)) {
                currencySymbol = incomingChain === 'FLARE' ? 'FLR' : incomingChain;
            } else if (['SGC', 'SGCN', 'SEAGULLCOIN'].includes(incomingAsset)) {
                currencySymbol = 'SEAGULLCOIN';
            } else if (['SGH', 'SGCSH', 'SEAGULLCASH'].includes(incomingAsset)) {
                currencySymbol = 'SEAGULLCASH';
            }

            const rawParsedAmount = parseFloat(incomingAmount);
            const formattedAmountStr = (!isNaN(rawParsedAmount) ? rawParsedAmount : 0).toFixed(7);

            // Set up dynamic address indicators for the ledger trace record
            let activeDebtorAddress = 'DEB_VAULT';
            if (incomingChain === 'HBAR') activeDebtorAddress = process.env.HBAR_ID || '0.0.10419620';
            else if (incomingChain === 'XRPL') activeDebtorAddress = 'rVKvTekTiqygS9qB27MPmsoDLyuD8PksF';
            else if (incomingChain === 'XLM') activeDebtorAddress = 'GAVRRQY2DBEKAPAG5DRRTRC3OBETKW4OW2VJON5FFBZGVT25ZCHRHBEK';
            else activeDebtorAddress = '0x870f64e73e7d2dc5022b4b74e58c323b3148a984';

            // 🦅 FIXED REPLACEMENT: Replaces the '@' and ALL periods globally to ensure a valid HashScan token path
            const clientExplorerHash = incomingChain === 'HBAR'
                ? String(finalTxHash).replace('@', '-').replace(/\./g, '-')
                : finalTxHash;

            const uetrUuid = `00000000-0000-4000-a000-${Date.now().toString().slice(-12)}`;
            const currentIsoTime = new Date().toISOString();
            const cleanShortHash = finalTxHash.includes('@') ? finalTxHash.split('@')[0] : finalTxHash.slice(0, 12);

            const isoXmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>SGC-MSG-${cleanShortHash}</MsgId>
      <CreDtTm>${currentIsoTime}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>IND</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>                                                                                                 
      <PmtId>
        <InstrId>INSTR-${cleanShortHash}</InstrId>
        <EndToEndId>${incomingMemo || '551374'}</EndToEndId>
        <UETR>${uetrUuid}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${currencySymbol}">${formattedAmountStr}</IntrBkSttlmAmt>
      <InstgAgt>
        <FinInstnId>
          <Nm>SEAGULL_SOVEREIGN_NODE</Nm>
          <Othr>
            <Id>SGC-${incomingChain}-DIRECT</Id>
          </Othr>
        </FinInstnId>
      </InstgAgt>
      <Dbtr>
        <Nm>Sovereign Sending Wallet</Nm>                                                                         
      </Dbtr>                                
      <Cdtr>
        <Nm>Sovereign Recipient Wallet</Nm>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`.trim();

            // Insert matching document object right into the live portal target stream
            await mongoose.connection.db.collection('iso_messages').insertOne({
                uetr: clientExplorerHash,
                amount: formattedAmountStr,
                currency: currencySymbol,
                sender: incomingChain,
                receiver: incomingChain,
                txHash: finalTxHash,
                chain: incomingChain,
                messageType: 'pacs.008',
                endToEndId: String(incomingMemo || '551374'),
                instructionId: String(new mongoose.Types.ObjectId()),
                debtor: {
                    name: 'Sovereign Sender',
                    address: String(activeDebtorAddress).trim(),
                    agent: 'SEAGULL_WALLET'
                },
                creditor: {
                    name: 'Sovereign Recipient',
                    address: String(incomingRecipient || 'UNKNOWN').trim(),
                    agent: String(incomingRecipient).startsWith('0x') ? 'EXTERNAL_WALLET' : 'NATIVE_WALLET'
                },
                remittanceInfo: `Sovereign Wallet Send: Direct ${incomingChain} Execution`,
                rawXml: isoXmlPayload,
                timestamp: new Date()
            });
            console.log(`🏛️ ISO 20022 Terminal Archive write complete for ${incomingChain} wallet send execution.`);

        } catch (isoErr) {
            console.error("⚠️ SYSTEM WARNING: ISO 20022 Dynamic Document Generation Halted:", isoErr.message);
        }

        // 🦅 4. SHARED DATABASE ALIGNMENT
        if (incomingMemo) {
            await mongoose.connection.db.collection('deposits').updateOne(
                { memo: String(incomingMemo).trim(), status: 'AWAITING_DEPOSIT' },
                {
                    $set: {
                        status: 'PROCESSING',
                        depositTxHash: results[0],
                        broadcastedAt: new Date()
                    }
                }
            );
            console.log(`🦅 Database synced for memo ${incomingMemo}.`);
        }

        res.json({ success: true, txHashes: results, txHash: results[0] });

    } catch (err) {                                                                                                 
        console.error("BROADCAST ERROR:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});



const TREASURY_EVM = "0x870f64e73e7d2dc5022b4b74e58c323b3148a984";

async function handleEVMSend(mnemonic, chain, amount, destination, symbol) {
    const RPC_URLS = {
        'FLARE': 'https://flare-api.flare.network/ext/C/rpc',
        'XDC': 'https://arpc.xinfin.network/',                                                                     
        'HBAR': 'https://mainnet.hashio.io/v1'
    };

    const provider = new ethers.JsonRpcProvider(RPC_URLS[chain]);
    const wallet = ethers.Wallet.fromPhrase(mnemonic).connect(provider);

    const total = parseFloat(amount);
    const fee = total * 0.005;
    const net = total - fee;

    // Map your Seagull Assets to their EVM Contract Addresses
    const CONTRACTS = {
        'FLARE': { SGC: '0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f' },
        'XDC':   { SGC: '0xd38109f587bd0326cad60a18cf3c1ecd546809a6', },
        'HBAR':  { SGH: '0x00000000000000000000000000000000002f8a24' }
    };

    if (['FLR', 'XDC', 'HBAR', 'NATIVE'].includes(symbol)) {
        // 🦅 NATIVE TRANSFER + FEE
        const tx = await wallet.sendTransaction({
            to: destination,
            value: ethers.parseEther(net.toString())
        });

        // Send 0.5% to the Master Treasury
        await wallet.sendTransaction({
            to: TREASURY_EVM,
            value: ethers.parseEther(fee.toString())
        });
        return tx.hash;

    } else {
        // 🦅 SOVEREIGN TOKEN (SGC/SGH) + FEE
        const tokenAddress = CONTRACTS[chain][symbol === 'SGCSH' ? 'SGH' : 'SGC'];
        const abi = ["function transfer(address to, uint amount) public returns (bool)"];
        const contract = new ethers.Contract(tokenAddress, abi, wallet);

        // Primary Send
        const tx = await contract.transfer(destination, ethers.parseUnits(net.toString(), 18));

        // 0.5% Fee to the Master Treasury
        await contract.transfer(TREASURY_EVM, ethers.parseUnits(fee.toString(), 18));
        return tx.hash;
    }
}


async function handleXRPLSend(mnemonic, amount, destination, symbol) {
    const client = new xrpl.Client("wss://xrplcluster.com");
    await client.connect();                                                                                 
    const wallet = xrpl.Wallet.fromMnemonic(mnemonic);
    const TREASURY_XRPL = "rVKvTekTiqygS9qB27MPmsoDLyuD8PksF"; // 🦅 Your Treasury
                                                                                                                const totalAmount = parseFloat(amount);
    const feeAmount = (totalAmount * 0.005).toFixed(6);
    const destAmount = (totalAmount - parseFloat(feeAmount)).toFixed(6);

    // 1. Transaction to Destination
    const txDest = {
        TransactionType: "Payment",
        Account: wallet.address,
        Amount: symbol === 'XRP'
            ? xrpl.xrpToDrops(destAmount)
            : { currency: symbol, value: destAmount, issuer: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno" },
        Destination: destination
    };                                                                                                                                                                                                                      // 2. Transaction to Treasury (The 0.5% Fee)
    const txFee = {
        TransactionType: "Payment",
        Account: wallet.address,
        Amount: symbol === 'XRP'
            ? xrpl.xrpToDrops(feeAmount)
            : { currency: symbol, value: feeAmount, issuer: "rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno" },
        Destination: TREASURY_XRPL
    };

    // Execute Destination Tx
    const preparedDest = await client.autofill(txDest);
    const signedDest = wallet.sign(preparedDest);
    const result = await client.submitAndWait(signedDest.tx_blob);

    // Execute Fee Tx (Fire and forget, or wait if you want to be sure)
    const preparedFee = await client.autofill(txFee);
    const signedFee = wallet.sign(preparedFee);
    await client.submit(signedFee.tx_blob);

    await client.disconnect();
    return result.result.hash;
}

async function handleStellarSend(mnemonic, amount, destination, symbol) {
    const server = new StellarSdk.Horizon.Server("https://horizon.stellar.org");                            
    // 🦅 Derive the Secret Key from Mnemonic                                                                   const seed = await bip39.mnemonicToSeed(mnemonic);
    const derived = derivePath("m/44'/148'/0'", seed.toString('hex'));
    const sourceKeys = StellarSdk.Keypair.fromRawEd25519Seed(derived.key);

    const account = await server.loadAccount(sourceKeys.publicKey());

    // 🦅 0.5% Sovereign Fee Calculation                                                                        const total = parseFloat(amount);                                                                           const feeAmt = (total * 0.005).toFixed(7);
    const netAmt = (total - parseFloat(feeAmt)).toFixed(7);

    // Identify if we are sending Native XLM or SeagullCash (SGH)
    const asset = (symbol === 'XLM' || symbol === 'NATIVE')
        ? StellarSdk.Asset.native()
        : new StellarSdk.Asset('SEAGULLCASH', 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7');

    // 🦅 The Atomic Batch: Two operations, one signature
    const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: StellarSdk.Networks.PUBLIC
    })
        .addOperation(StellarSdk.Operation.payment({
            destination: destination,
            asset: asset,
            amount: netAmt
        }))
        .addOperation(StellarSdk.Operation.payment({
            destination: 'GAVRRQY2DBEKAPAG5DRRTRC3OBETKW4OW2VJON5FFBZGVT25ZCHRHBEK', // Treasury
            asset: asset,
            amount: feeAmt
        }))
        .setTimeout(30)
        .build();

    transaction.sign(sourceKeys);

    const result = await server.submitTransaction(transaction);
    console.log(`✅ Stellar Atomic Payout Success: ${result.hash}`);
    return result.hash;
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error({ module: 'GlobalError', error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});                                                                                                         
let lastAuditStatus = 'UNKNOWN';
let lastAuditTime = null;
let maintenanceMode = false;
let server;

// Boot sequence
const start = async () => {
  console.log("!!! SEAGULL BOOT SEQUENCE INITIATED !!!");
  try {
    await mongoose.connect(process.env.MONGO_URI);;
    logger.info({ event: 'mongodb_connected' });

       const db = mongoose.connection.db;
    app.set('db', db);

       // 🚀 WIRE THE GLOBAL RICHLIST INDEXER HERE
    try {
      triggerGlobalEcosystemSync(); // Fires on application boot
      setInterval(triggerGlobalEcosystemSync, 1000 * 60 * 60); // Loops safely once an hour
    } catch (idxErr) {
      logger.error({ module: 'IndexerBoot', error: idxErr.message });
    }

  startBackgroundDataLogging(db);

    await startXrplListener();
    await startStellarListener();
    await startHederaListener();
    await startEvmListeners();

    cron.schedule('0 * * * *', async () => {
      if (maintenanceMode) return;
      try {
        const r = await performFullAudit();
        lastAuditStatus = r.overallStatus;
        lastAuditStatusGauge.set(r.overallStatus === 'SOLVENT' ? 1 : 0);
        lastAuditTime = new Date();
      } catch (e) {
        logger.error({ module: 'AuditCron', error: e.message });
      }                                                                                                         });


    server = app.listen(PORT, () => {
      logger.info({ event: 'server_listening', port: PORT });
      performFullAudit().then(report => {                                                                           lastAuditStatus = report.overallStatus;
        lastAuditStatusGauge.set(report.overallStatus === 'SOLVENT' ? 1 : 0);
        lastAuditTime = new Date();
        logger.info({ event: 'initial_audit_complete', status: lastAuditStatus });
      }).catch(e => {
        logger.error({ event: 'initial_audit_failed', error: e.message });
        lastAuditStatus = 'UNKNOWN';
        lastAuditStatusGauge.set(-1);
      });
    });

    initSocket(server);
    logger.info({ event: 'all_services_online' });
  } catch (err) {                                                                                               logger.fatal({ event: 'bootstrap_failed', error: err.message });
    process.exit(1);
  }
};

setInterval(() => {
  if (!maintenanceMode) runConfirmationCycle().catch(e => logger.error({ module: 'DepositEngine', error: e.message }));
}, 10000);



// SPA catch-al (Frontend link)l
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
});

start();

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info({ event: 'shutdown_initiated', signal });
  maintenanceMode = true;

  if (server) {
    server.close((err) => {
      if (err) logger.error({ event: 'server_close_error', error: err.message });
      else logger.info({ event: 'http_server_closed' });
    });                                                                                                       }                                                                                                         
  setTimeout(async () => {
    try {
      await mongoose.connection.close(false);
      logger.info({ event: 'mongodb_closed' });
    } catch (err) {
      logger.error({ event: 'mongodb_close_error', error: err.message });
    }
    logger.info({ event: 'shutdown_complete' });                                                                process.exit(0);
    }, 8000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ event: 'unhandled_rejection', reason }));
