const { ethers } = require('ethers');
const { generateSwiftXml } = require('../utils/isoHelpers');


// 🦅 THE SOVEREIGN OVERRIDE: Kills ENS, Checksums, and 0xxdc Double-Headers
ethers.resolveAddress = (target) => {
    if (typeof target === 'string') {
        // 1. Lowercase and trim to kill checksum sensitivity
        let clean = target.toLowerCase().trim();

        // 2. The "Double-Header" fix: if it starts with 0xxdc, strip it down to 0x
        if (clean.startsWith('0xxdc')) {
            clean = clean.replace('0xxdc', '0x');
        }
        // 3. Standardize regular xdc prefix to 0x for Ethers v6
        else if (clean.startsWith('xdc')) {
            clean = clean.replace('xdc', '0x');
        }

        // 4. Ensure it always has exactly one 0x
        if (!clean.startsWith('0x')) clean = `0x${clean}`;

        return clean;
    }
    return target;
};

const path = require('path'); // 🦅 Keep this - it's already here
const xrpl = require('xrpl');
const { Client: XrplClient, xrpToDrops, Wallet } = require('xrpl');
const crypto = require('crypto');
const {
    Client: HbarClient,
    PrivateKey,
    TransferTransaction,
    AccountId,
    TokenId
} = require("@hashgraph/sdk");
const Decimal = require('decimal.js');
const { Builder } = require('xml2js');

// 🦅 THE FIX: One clean line to reach the root .env
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });



function generatePacs008(txHash, receiver, amount, symbol, chain) {
  const builder = new Builder();

  // 🦅 UNIVERSAL NORMALIZE
  const safeChain = String(chain || "HBAR").toUpperCase();
  const safeSymbol = String(symbol || "SEAGULLCASH").toUpperCase();
  const safeAmount = String(amount || "0");
  const rawReceiver = String(receiver || "").trim();

  // 🦅 SMART ADDRESS CLEANER
  let safeReceiver;
  if (safeChain === 'HBAR') {
      safeReceiver = rawReceiver.replace(/[^\d.]/g, ''); // 0.0.123
  } else if (safeChain === 'XDC') {
      // 🦅 XDC FIX: Keep the 'xdc' prefix but strip illegal XML junk
      safeReceiver = rawReceiver.replace(/^0x/, 'xdc').replace(/[<>&"']/g, '');
  } else {
      // XRPL (r...), Stellar (G...), ETH (0x...)
      safeReceiver = rawReceiver.replace(/[<>&"']/g, '');
  }

  const msg = {
    Document: {
      $: { xmlns: "urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08" },
      FIToFICstmrCdtTrf: {
        GrpHdr: {
            MsgId: `SEAGULL-${safeChain}-${Date.now()}`,
            CreDtTm: new Date().toISOString()
        },
        CdtTrfTxInf: {
          PmtId: { EndToEndId: String(txHash) },
          IntrBkSttlmAmt: { $: { Ccy: safeSymbol }, _: safeAmount },
          InstdAmt: { $: { Ccy: safeSymbol }, _: safeAmount },
          ChrgBr: "DEBT",
          Dbtr: { Nm: "Seagull Hot Wallet" },
          Cdtr: {
              Nm: "End User",
              PstlAdr: { AdrLine: safeReceiver }
          },
                    SplmtryData: { Envlp: { TxHash: String(txHash), Chain: safeChain } }
        }
      }
    }
  };
  return builder.buildObject(msg);
}


// 🦅 THE CLEAN START: Matches the Orchestrator's 4 variables
async function settleOnChain(walletAddress, amount, symbol, chain) {
  // 🦅 1. DATA UNPACKER
  const isObj = typeof walletAddress === 'object';

  const finalAddr = isObj ? (walletAddress.toAddress || walletAddress.targetAddr || walletAddress.userWallet || walletAddress.destination) : walletAddress;
  const finalAmt  = isObj ? (walletAddress.amount || walletAddress.targetAmount) : amount;
  const finalSym  = isObj ? (walletAddress.asset || walletAddress.symbol || "SEAGULLCASH") : symbol;
  const finalChain = isObj ? (walletAddress.toChain || walletAddress.chain || "FLARE") : chain;

  const selectedChain = String(finalChain || "FLARE").toUpperCase();
  const selectedSymbol = String(finalSym || "SEAGULLCASH").toUpperCase();

  // 🦅 SMART TARGET: Only force 0x for Flare/Ethereum/XDC. Leave XLM/XRP/HBAR alone.
  const ethChains = ['FLARE', 'XDC', 'ETH', 'BASE', 'POLY'];


    // 🦅 SMART TARGET: Only force 0x for Flare/Ethereum/XDC. Leave XLM/XRP/HBAR alone.
   // 🦅 FORCE STRING: This stops the 'replace' crash dead
  const safeAddr = String(finalAddr || "").trim();

  const target = ethChains.includes(selectedChain)
                 ? (safeAddr.startsWith('0x') ? safeAddr : `0x${safeAddr}`)
                 : safeAddr.replace(/^0x/, '');

 console.log(`🧪 BRIDGE_RECEIVE_DEBUG: Symbol received is [${symbol}]`);


  // 🦅 2. THE DECIMAL MAP (The Alignment Engine)
  const decimalMap = { 'XRPL': 6, 'HBAR': 6, 'XLM': 7, 'XDC': 18, 'FLARE': 18 };
  const destDecimals = decimalMap[selectedChain] || 18;

    // 🦅 3. THE MATH (Ratio Engine + Scaling)
  // We start with the raw input amount
  let rawDecimalAmount = new Decimal(String(typeof finalAmt === 'object' ? finalAmt.amount : (finalAmt || "0")));

  // We check for 'isConversion' or 'convert' fields in the record
  const isConversion = (walletAddress.isConversion === true || walletAddress.convert === true);

 // What the user has in their account vs. what we are settling on the target chain
  const sourceSym = String(walletAddress.sourceSymbol || selectedSymbol).toUpperCase();
  const targetSym = selectedSymbol.toUpperCase();

  if (sourceSym === 'SEAGULLCOIN' && targetSym === 'SEAGULLCASH') {
      // 🦅 DEVALUATION/SPLIT: 1 Coin becomes 1000 Cash
      rawDecimalAmount = rawDecimalAmount.times(1000);
      console.log(`⚖️  GLOBAL SWAP: 1 Coin -> 1000 Cash applied for ${selectedChain}`);
  } else if (sourceSym === 'SEAGULLCASH' && targetSym === 'SEAGULLCOIN') {
      // 🦅 CONSOLIDATION: 1000 Cash becomes 1 Coin
      rawDecimalAmount = rawDecimalAmount.div(1000);
      console.log(`⚖️  GLOBAL CONVERSION: 1000 Cash -> 1 Coin applied for ${selectedChain}`);
  } else {
      console.log(`🚀 GLOBAL DIRECT: 1:1 Transfer for ${targetSym} on ${selectedChain}`);
  }

  // Calculate 0.4% Bridge Tax AFTER the ratio adjustment
  const amountAfterFee = rawDecimalAmount.minus(rawDecimalAmount.times(0.004));

  // humanAmount: What goes in the ISO 20022 XML (e.g., 0.00996)
  const humanAmount = amountAfterFee.toFixed(6);

  // onChainAmount: The "Integer" sent to the Ledger (e.g., 996000000000000)
  const onChainAmount = amountAfterFee.times(new Decimal(10).pow(destDecimals)).toFixed(0);

  let txHash;
  console.log(`🚀 Bridge Ignited: [${selectedChain}] Sending ${humanAmount} ${selectedSymbol} to ${target}`);



  switch (selectedChain) {

case 'XRP':
        case 'XRPL': {
            // 🦅 1. DIRECT ADDRESS RECOVERY
            const xrpTarget = (walletAddress.targetAddr || walletAddress.destinationAddress || walletAddress.destination || target);
            const xClient = new xrpl.Client('wss://xrplcluster.com');
           await xClient.connect();


      // 🦅 THE FOUNDATION: Define symbol first so math works later
      const currentSymbol = String(selectedSymbol || "").toUpperCase().trim();

      const rawSecret = (process.env.BRIDGE_XRPL_SECRET || "").trim();
      const words = String(rawSecret || "").replace(/['"]/g, '').split(/\s+/);
      const cleanSecret = words.join(' ');
      // Stop the crash before it happens
      if (!rawSecret) {
          throw new Error("❌ BRIDGE_XRPL_SECRET is missing from .env! Ensure you are running from the project root.");
      }


      let xWallet;


      if (words.length < 12) {
          try {
              xWallet = xrpl.Wallet.fromSeed(cleanSecret); // 🦅 Remove 'const' here
              console.log(`🦅 XRPL SENDER ACTIVE (SEED): ${xWallet.address}`);
                    } catch (e) {
              throw new Error(`Invalid XRPL Secret: Found ${words.length} words...`);
          } // <--- This closes the CATCH
      } else { // <--- This closes the IF and starts the ELSE
          xWallet = xrpl.Wallet.fromMnemonic(cleanSecret);
          console.log(`🦅 XRPL SENDER ACTIVE (MNEMONIC): ${xWallet.address}`);
      }


      // 🦅 PASTE THE FIX HERE (Right before 2. GENERATE THE ISO XML)
      const cleanTarget = String(xrpTarget || target).trim();
      console.log(`🔍 DEBUG: Validating Destination: [${cleanTarget}]`);

      // ⚖️ 2. THE 1000:1 MATH (The only thing that matters)
      const isConversion = (typeof walletAddress === 'object' && walletAddress.isConversion === true);

      let finalMathAmount = humanAmount;

      if (currentSymbol === 'SEAGULLCOIN' && isConversion) {
          finalMathAmount = Number(humanAmount) / 1000;
          console.log(`⚖️  CONVERSION MODE: 1000 Cash -> 1 Coin applied.`);
      } else {
          console.log(`🚀 DIRECT MODE: 1:1 Transfer for ${currentSymbol}`);
      }



            // 2. GENERATE THE ISO XML (Using humanAmount for readability)
      const isoXml = generateSwiftXml({
        txHash: `SGC-TX-${Date.now()}`, // Temporary hash for bridge session
        amount: humanAmount,
        currency: selectedSymbol,
        endToEndId: Math.random().toString(36).substring(2).toUpperCase(),
        sender: 'XLM',   // Or map dynamically based on your session configuration
        receiver: 'XRPL' // Or map dynamically based on your session configuration
      });

      const isoHex = Buffer.from(isoXml).toString('hex').toUpperCase();




          // 3. DYNAMIC ISSUER & HEX SELECTION
      // 🦅 Define the specific HEX codes for the Ledger
      const HEX_CASH = '53656167756C6C43617368000000000000000000';
      const HEX_COIN = '53656167756C6C436F696E000000000000000000';

      // 🦅 Explicitly set Issuer based on the name
      let issuerAddress = '';
      let selectedHex = '';

      if (currentSymbol === 'SEAGULLCASH') {
          issuerAddress = 'rNHeGnj4kqGSVyFzDcoyi3gsp1bdPuGeNK';
          selectedHex = HEX_CASH;
      } else if (currentSymbol === 'SEAGULLCOIN') {
          issuerAddress = 'rnqiA8vuNriU9pqD1ZDGFH8ajQBL25Wkno';
          selectedHex = HEX_COIN;
      }

  // 🦅 THE LOG FIX: This makes the HEX show up on your screen
      const displayAsset = (currentSymbol === 'XRP') ? 'XRP' : `${currentSymbol} (${selectedHex.substring(0,8)}...)`;
      console.log(`🚀 Bridge Ignited: [XRPL] Sending ${humanAmount} ${displayAsset} to ${cleanTarget}`);

      // 🦅 SAFETY CHECK: If no asset was matched, stop the engine before it crashes
      if (currentSymbol !== 'XRP' && (!issuerAddress || !selectedHex)) {
          throw new Error(`Unsupported Asset: ${currentSymbol}. Bridge only supports XRP, SEAGULLCASH, or SEAGULLCOIN.`);
      }

 // 4. TRANSACTION PREPARATION
      const txJSON = {
        TransactionType: "Payment",
        Account: xWallet.address,
        Destination: cleanTarget, // 🦅 Force string and trim again right here
        Amount: (currentSymbol === "XRP")
          ? xrpl.xrpToDrops(finalMathAmount)
          : {
              currency: selectedHex, // 🦅 Now using the explicitly chosen HEX
              issuer: issuerAddress, // 🦅 Now using the explicitly chosen Issuer
              value: String(finalMathAmount)
            },

               Memos: [
          {
            Memo: {
              MemoType: Buffer.from("ISO20022_HASH").toString('hex').toUpperCase(),
              MemoFormat: Buffer.from("text/plain").toString('hex').toUpperCase(),
              MemoData: require('crypto').createHash('sha256').update(isoXml).digest('hex').toUpperCase() // 🚀 Always exactly 64 hex characters
            }
          }
        ]

      };

console.log(`📡 FINAL BROADCAST CHECK - Destination: "${txJSON.Destination}" (Length: ${txJSON.Destination.length})`);


          // 🦅 THE CLEAN EXECUTION (No duplicates!)
      const prepared = await xClient.autofill(txJSON);
      const signed = xWallet.sign(prepared);
      const result = await xClient.submitAndWait(signed.tx_blob);

      if (result.result.meta.TransactionResult !== "tesSUCCESS") {
        throw new Error(`XRPL Error: ${result.result.meta.TransactionResult}`);
      }

      txHash = result.result.hash;
      console.log(`✅ SUCCESS! ISO Message Anchored. Hash: ${txHash}`);
      await xClient.disconnect();
      break;
     }
          case 'XDC': {
    // 🦅 1. AUTH & CONTRACT (No provider attached to wallet yet)
    const sglcnContractAddr = "0xd38109F587bd0326CAd60a18CF3C1ECD546809a6";
    const xdcPkRaw = process.env.XDC_PRIVATE_KEY || process.env.XDC_PRIVATE_KEY_MAIN;
    const finalPk = xdcPkRaw.startsWith('0x') ? xdcPkRaw : `0x${xdcPkRaw}`;
    
    // Provider is ONLY used for data fetching, not attached to the wallet
    const provider = new ethers.JsonRpcProvider(process.env.XDC_RPC_URL, { name: 'xdc', chainId: 50 }, { staticNetwork: true });
    const wallet = new ethers.Wallet(finalPk); // 👈 OFFLINE WALLET

    // 🦅 2. TARGET NORMALIZING
    const cleanHex = target.toLowerCase().trim().replace(/^0x|^xdc/, '');
    const finalDestination = ethers.getAddress(`0x${cleanHex}`); // Checksum it!
    const checksummedContract = ethers.getAddress(sglcnContractAddr);

    // 🦅 3. MANUAL DATA ENCODING
    const iface = new ethers.Interface(["function transfer(address to, uint256 amount)"]);
    const data = iface.encodeFunctionData("transfer", [finalDestination, onChainAmount]);

    // 🦅 4. THE HARD-CODED DRAFT (Matches your Flare style)
    const tx = {
        to: checksummedContract,
        data: data,
        value: 0,
        gasLimit: 150000, // XDC needs a bit more for contract calls
        gasPrice: (await provider.getFeeData()).gasPrice,
        nonce: await provider.getTransactionCount(wallet.address),
        chainId: 50,
        type: 0
    };

    console.log(`🚀 XDC BYPASS: Signing offline to prevent RPC exhaustion...`);

    // 🦅 5. SIGN & PUSH (The Silent Kill)
    const signedTx = await wallet.signTransaction(tx);
    const response = await provider.broadcastTransaction(signedTx);

    // 🦅 NO .WAIT() HERE! We return the hash and let the confirmation engine handle the rest.
    txHash = response.hash;
    console.log(`✅ SUCCESS! XDC Tx Hash: ${txHash}`);
    break;
}


case 'FLARE': {
      const sglcnContractAddr = "0x495daFA49eD19f3bFC3ddeb7e048f20ff149778f";
      const rpc = process.env.FLARE_RPC_URL || "https://flare-api.flare.network/ext/C/rpc";

      try {
          const provider = new ethers.JsonRpcProvider(rpc);

          // 🦅 1. CHECKSUM EVERYTHING
          // This stops 'resolveName' because Ethers sees the proper casing and knows it's a hex address.
          const checksummedContract = ethers.getAddress(sglcnContractAddr);
          const checksummedTarget   = ethers.getAddress(target);

          // 🦅 2. OFFLINE WALLET
          // We create a wallet with NO provider so it physically cannot call 'resolveName'
          const wallet = new ethers.Wallet(process.env.BRIDGE_FLARE_PRIVATE_KEY);

          // 🦅 3. MANUAL DATA ENCODING
          const iface = new ethers.Interface(["function transfer(address to, uint256 amount)"]);
          const data = iface.encodeFunctionData("transfer", [checksummedTarget, onChainAmount]);

          // 🦅 4. THE HARD-CODED DRAFT
          const tx = {
              to: checksummedContract,
              data: data,
              gasLimit: 120000,
              gasPrice: (await provider.getFeeData()).gasPrice,
              nonce: await provider.getTransactionCount(wallet.address),
              chainId: 14,
              type: 0
          };

          console.log(`🚀 BASH BYPASS: Signing raw hex (Total Offline Mode)...`);

          // 🦅 5. SIGN & PUSH
          const signedTx = await wallet.signTransaction(tx);
          const response = await provider.broadcastTransaction(signedTx);

          txHash = response.hash;
          console.log(`✅ SUCCESS! Flare Tx Hash: ${txHash}`);

      } catch (err) {
          console.error("🆘 BASH ERROR:", err.message);
          throw err;
      }
      break;
    }

case 'XLM': {

      const StellarSdk = require('stellar-sdk');

      const server = new StellarSdk.Horizon.Server(process.env.STELLAR_RPC_URL || "https://horizon.stellar.org");

      // 🦅 1. SANITIZE FIRST
      const rawSecret = (process.env.BRIDGE_STELLAR_SECRET || "").trim();

      // 🦅 2. THEN INITIALIZE THE SOURCE
      const source = StellarSdk.Keypair.fromSecret(rawSecret);

      console.log(`🦅 SENDER ACTIVE: ${source.publicKey()}`);

      // 🦅 1. GENERATE THE ISO 20022 XML (Human Readable)
      const isoXml = `<?xml version="1.0" encoding="UTF-8"?
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08"
  <FIToFICstmrCdtTrf
    <GrpHdr
      <MsgId>SEAGULL-XLM-${Date.now()}</MsgId>
    </GrpHdr
    <CdtTrfTxInf
      <PmtId><EndToEndId>${Math.random().toString(36).substring(2)}</EndToEndId></PmtId
      <IntrBkSttlmAmt Ccy="${selectedSymbol}">${humanAmount}</IntrBkSttlmAmt
      <Dbtr><Nm>Seagull Hot Wallet</Nm></Dbtr
      <Cdtr><Nm>End User</Nm><PstlAdr><AdrLine>${target}</AdrLine></PstlAdr></Cdtr
    </CdtTrfTxInf
  </FIToFICstmrCdtTrf
</Document>`;

      // 🦅 2. CREATE THE ISO ANCHOR (SHA-256 Hash for Memo)
      const xmlHash = crypto.createHash('sha256').update(isoXml).digest();

      // 🦅 3. PREPARE ASSET & ACCOUNT
        // --- START OF SWAP ---
      let asset;
      const cleanSym = selectedSymbol.toUpperCase();

      if (cleanSym === 'XLM') {
          asset = StellarSdk.Asset.native();
      } else {
          // 🦅 Map DB symbol to the exact Case-Sensitive Stellar Code
          const assetCode = (cleanSym === 'SEAGULLCOIN') ? 'SeagullCoin' : 'SeagullCash';
          const issuer = 'GBC2VA3YMAIVB3A77VNRPKMQI3RAPDUDDP7JI2PE426MGKDDJFPRVWP7';

          console.log(`🎯 STELLAR MAPPING: ${selectedSymbol} -> ${assetCode}`);
          asset = new StellarSdk.Asset(assetCode, issuer);
      }

           // 🦅 BUILD & ANCHOR
      const account = await server.loadAccount(source.publicKey());
      const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE })
        .addOperation(StellarSdk.Operation.payment({
            destination: target,
            asset: asset,
            amount: new Decimal(humanAmount).toFixed(7)
        }))
        // 🦅 Fix: Use ManageData to anchor the ISO hash so the Memo slot is free
        .addOperation(StellarSdk.Operation.manageData({
            name: 'ISO_2022_HASH',
            value: xmlHash
        }))
        // 🦅 Fix: Use Memo.text so your StellarListener doesn't ignore the TX
        .addMemo(StellarSdk.Memo.text("SeagullNet-Settlement"))
        .setNetworkPassphrase(StellarSdk.Networks.PUBLIC)
        .setTimeout(30)
        .build();


      tx.sign(source);
      console.log(`⚓ Anchoring ISO Hash: ${xmlHash.toString('hex')}`);

      const res = await server.submitTransaction(tx);
      txHash = res.hash;
      break;
      }

                    case 'HBAR': {
      // 🦅 1. DYNAMIC TOKEN RECOVERY
      // Uses 0.0.3115556 for SeagullCash as per your correction
      const hToken = (selectedSymbol === 'SEAGULLCASH')  ? "0.0.3115556" 
      : (process.env.HEDERA_COIN_TOKEN_ID || "0.0.3116734");
                   
      const hAcc = process.env.HEDERA_ACCOUNT_ID || "0.0.10419620";
      const rawKey = process.env.HBAR_HOT_WALLET_KEY || process.env.HEDERA_PRIVATE_KEY || "";
      const hPk = String(rawKey).trim().replace(/^0x/, '');

      if (!hPk || !hAcc) throw new Error(`❌ BRIDGE_SERVICE: Missing HBAR Credentials.`);

      const client = HbarClient.forMainnet();
            let privateKey;
      try {
          // 🦊 Try Ethereum-style (ECDSA) first
          privateKey = PrivateKey.fromStringECDSA(hPk);
      } catch (e) {
          try {
              // 🦅 Fallback to Hedera Native (ED25519)
              privateKey = PrivateKey.fromStringED25519(hPk);
          } catch (err) {
              // 🚨 Last resort: let the SDK try to guess
              privateKey = PrivateKey.fromString(hPk);
          }
      }
      client.setOperator(AccountId.fromString(hAcc), privateKey);

      // 🦅 2. RECIPIENT ROUTER (The EVM Handshake)
      // Allows bridging to 0x addresses for Flare/XDC/Base
      const recipient = target.startsWith("0x") 
          ? AccountId.fromEvmAddress(target) 
          : AccountId.fromString(target);

      // 🦅 3. ISO 20022 GENERATION
      const isoXml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>SEAGULL-HBAR-${Date.now()}</MsgId>
      <CreDtTm>${new Date().toISOString()}</CreDtTm>
    </GrpHdr>
    <CdtTrfTxInf>
      <IntrBkSttlmAmt Ccy="${selectedSymbol}">${humanAmount}</IntrBkSttlmAmt>
      <Dbtr><Nm>Seagull Treasury</Nm></Dbtr>
      <Cdtr><Nm>Recipient</Nm><PstlAdr><AdrLine>${target}</AdrLine></PstlAdr></Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

      const xmlHash = crypto.createHash('sha256').update(isoXml).digest('hex');
      console.log(`⚓ ISO Anchor: ${xmlHash}`);

      // 🦅 4. BUILD & EXECUTE
      const transaction = await new TransferTransaction()
        .addTokenTransfer(TokenId.fromString(hToken), AccountId.fromString(hAcc), -onChainAmount)
        .addTokenTransfer(TokenId.fromString(hToken), recipient, onChainAmount)
        .setTransactionMemo(xmlHash) // The Long Hash in your wallet
        .freezeWith(client);

      const response = await (await transaction.sign(privateKey)).execute(client);
      const receipt = await response.getReceipt(client);

      txHash = response.transactionId.toString();
      console.log(`✅ HEDERA SUCCESS! Asset: ${selectedSymbol} | TxID: ${txHash}`);
      break;
    }



        default:
      throw new Error(`Chain ${chain} not supported`);
  }

      // 🦅 5. FINAL AUDIT LOG
  const finalIsoRecord = generatePacs008(txHash, target, humanAmount, selectedSymbol, selectedChain);
  console.log("📄 FINAL ISO 20022 RECORD GENERATED:");
  console.log(finalIsoRecord);

  return txHash;
}


// 🦅 THE BRIDGE HANDSHAKE (REPLACE YOUR OLD ONE WITH THIS)
async function execute(session) {
    // 🦅 SMART ADDRESS DETECTION
    // Checks every possible spot the address could be hiding
    const targetAddr = session.targetAddr ||
                       session.userWallet ||
                       (session.outbound && session.outbound.destination) ||
                       session.destination;

    // 🦅 SMART AMOUNT DETECTION
    // Checks if 'amount' is a raw number or hidden inside an object
    let targetAmount = session.amount || (session.outbound && session.outbound.amount);
    if (typeof targetAmount === 'object' && targetAmount.amount) {
        targetAmount = targetAmount.amount;
    }

    const targetAsset = session.asset || (session.outbound && session.outbound.symbol) || "SEAGULLCASH";
    const targetChain = session.toChain || (session.outbound && session.outbound.chain) || "FLARE";

    // 🦅 SAFETY LOCK
    if (!targetAddr || targetAddr === "undefined") {
        console.log("DEBUG SESSION OBJECT:", JSON.stringify(session, null, 2));
        throw new Error("❌ EXECUTE ERROR: Target Address not found in session object.");
    }

    return await settleOnChain(
        targetAddr,
        targetAmount,
        targetAsset,
        targetChain
    );
}


module.exports = {
    settleOnChain,
    execute
};
