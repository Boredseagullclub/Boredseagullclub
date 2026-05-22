// File: utils/isoHelpers.js

const { ethers } = require('ethers');

// Helper to cleanly convert raw blockchain hash/IDs to a valid, schema-compliant 36-char UETR UUIDv4
function formatToUetr(hash) {
  if (!hash) return "00000000-0000-4000-a000-000000000000";
  const clean = hash.replace(/[^a-fA-F0-9]/g, '');
  if (clean.length < 32) return "00000000-0000-4000-a000-" + clean.padEnd(12, '0').slice(0, 12);
  return `${clean.slice(0,8)}-${clean.slice(8,12)}-4${clean.slice(13,16)}-${(parseInt(clean.slice(16,17), 16) & 0x3 | 0x8).toString(16)}${clean.slice(17,20)}-${clean.slice(20,32)}`;
}

/**
 * 🚀 High-Fidelity, Bank-Grade pacs.008.001.08 XML Generator
 */
function generateSwiftXml({ txHash, amount, currency, endToEndId, sender, receiver, timestamp }) {
  const hash = txHash || "UNKNOWN_TX";
  const uetr = formatToUetr(hash);
  const time = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
  const amt = amount || "0.0000000";
  const ccy = currency || "SEAGULLCASH";
  const e2e = endToEndId || "NO_REF";

  const senderName = sender ? `${sender.toUpperCase()}_BRIDGE_VAULT` : "XLM_BRIDGE_VAULT";
  const receiverName = receiver ? `${receiver.toUpperCase()}_BRIDGE_VAULT` : "XRPL_BRIDGE_VAULT";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>SGC-MSG-${hash.slice(0, 12).toUpperCase()}</MsgId>
      <CreDtTm>${time}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <SttlmInf>
        <SttlmMtd>IND</SttlmMtd>
      </SttlmInf>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>INSTR-${hash.slice(0, 12).toUpperCase()}</InstrId>
        <EndToEndId>${e2e}</EndToEndId>
        <UETR>${uetr}</UETR>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${ccy}">${amt}</IntrBkSttlmAmt>
      <InstgAgt>
        <FinInstnId>
          <Nm>SEAGULL_PROTOCOL_NODE</Nm>
          <Othr>
            <Id>SEAGULL-XLM-XYZ</Id>
          </Othr>
        </FinInstnId>
      </InstgAgt>
      <Dbtr>
        <Nm>${senderName}</Nm>
      </Dbtr>
      <Cdtr>
        <Nm>${receiverName}</Nm>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;
}

function generateInitialIsoHash(session) {
  const timestamp = new Date().toISOString();
  const msgId = `SGL-${session.fromChain || 'BRIDGE'}-${Date.now()}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.008.001.08">
  <FIToFICstmrCdtTrf>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${timestamp}</CreDtTm>
    </GrpHdr>
    <CdtTrfTxInf>
      <PmtId>
        <InstrId>SGL-SESSION-${session.sessionId || 'PENDING'}</InstrId>
        <EndToEndId>${msgId}</EndToEndId>
      </PmtId>
      <IntrBkSttlmAmt Ccy="${session.asset || 'SGLCN'}">${session.amount || '0'}</IntrBkSttlmAmt>
      <InstdAmt Ccy="${session.asset || 'SGLCN'}">${session.amount || '0'}</InstdAmt>
      <Dbtr><Nm>Bored Seagull Vault</Nm></Dbtr>
      <Cdtr>
        <Nm>End User</Nm>
        <PstlAdr><AdrLine>${session.userWallet || '0x0'}</AdrLine></PstlAdr>
      </Cdtr>
    </CdtTrfTxInf>
  </FIToFICstmrCdtTrf>
</Document>`;

  return ethers.id(xml);
}

module.exports = { 
  generateInitialIsoHash,
  generateSwiftXml
};

