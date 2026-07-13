import React, { useState } from 'react';
import axios from 'axios';

const KycModal = ({ seagullNetId, targetTier, onVerificationSuccess, onClose }) => {
  const [step, setStep] = useState(1);
  const [verifying, setVerifying] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '', lastName: '', dob: '', country: '', nationalId: '', passkey: '', document: null
  });

  const handleInputChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  const handleFileChange = (e) => setFormData({ ...formData, document: e.target.files[0] });

  // BIOMETRIC SIGNATURE CAPTURE
  const triggerBiometricScan = async () => {
    const publicKeyCredentialCreationOptions = {
      challenge: Uint8Array.from(window.crypto.getRandomValues(new Uint8Array(32))),
      rp: { name: "Seagull Institutional Node", id: window.location.hostname },
      user: {
        id: Uint8Array.from(seagullNetId, c => c.charCodeAt(0)),
        name: seagullNetId,
        displayName: seagullNetId,
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
      attestation: "direct"
    };

    try {
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions
      });

      const signature = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      setFormData(prev => ({ ...prev, passkey: signature }));
      alert('✅ Biometric proof verified by device hardware.');
    } catch (err) {
      console.error("Biometric failed:", err);
      alert('❌ Biometric capture cancelled or hardware not supported.');
    }
  };

  const handleVerify = async () => {
    if (!formData.document || !formData.nationalId || !formData.passkey) {
      return alert('Verification requires complete data including biometric signature.');
    }
    setVerifying(true);

    const uploadData = new FormData();
    const secureFile = new File([formData.document], "kyc_document.jpg", { type: "image/jpeg" });
    uploadData.append('document', secureFile);

    // Mapped to backend keys
    uploadData.append('seagullNetId', seagullNetId);
    uploadData.append('fullName', `${formData.firstName} ${formData.lastName}`.trim());
    uploadData.append('dateOfBirth', formData.dob);
    uploadData.append('country', formData.country);
    uploadData.append('documentType', 'GOVERNMENT_ID');
    uploadData.append('documentNumber', formData.nationalId);
    uploadData.append('globalTaxIdOrSsn', formData.nationalId);
    uploadData.append('passkeyPublicKey', formData.passkey);
    uploadData.append('targetTier', targetTier);

    try {
      // FIXED: Pointing to the EXACT route from your backend code
      const res = await axios.post('/api/agent/kyc/submit', uploadData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (res.data.success) {
        setStep(3);
        setTimeout(() => onVerificationSuccess(res.data.registration), 1500);
      }
    } catch (err) {
      const realError = err.response?.data?.message || err.response?.data?.error || "Unknown Error";
      alert('❌ BACKEND REJECTION: ' + realError);
      setVerifying(false);
    }
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.header}>
          <h2 style={s.title}>Identity Verification</h2>
          <button onClick={onClose} style={s.closeBtn}>✕</button>
        </div>

        <div style={s.contextBar}>
          <small>ID: {seagullNetId} | Tier: {targetTier}</small>
        </div>

        {step === 1 && (
          <div style={s.form}>
            <input name="firstName" placeholder="First Name" onChange={handleInputChange} style={s.input} />
            <input name="lastName" placeholder="Last Name" onChange={handleInputChange} style={s.input} />
            <label style={s.label}>Date of Birth</label>
            <input type="date" name="dob" onChange={handleInputChange} style={s.input} />
            <input name="country" placeholder="Country of Origin" onChange={handleInputChange} style={s.input} />
            <input name="nationalId" placeholder="SSN / Tax ID" onChange={handleInputChange} style={s.input} />

            <label style={s.label}>Biometric Proof</label>
            <button onClick={triggerBiometricScan} style={formData.passkey ? s.btnSuccess : s.btn}>
              {formData.passkey ? '✓ Biometric Signature Captured' : 'Scan Fingerprint / FaceID'}
            </button>

            <button onClick={() => setStep(2)} style={{...s.btn, marginTop: '12px'}}>Continue to Biometrics</button>
          </div>
        )}

        {step === 2 && (
          <div style={s.form}>
            <p style={s.info}>Please upload a government-issued ID for liveness verification.</p>
            <input type="file" onChange={handleFileChange} accept="image/*" style={s.fileInput} />
            <button onClick={handleVerify} disabled={verifying} style={s.btn}>
              {verifying ? 'Processing...' : 'Submit Securely'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div style={s.successBox}>
            <p>✓ Payload submitted to AWS Rekognition.</p>
            <p>Compliance status: PENDING_REVIEW</p>
          </div>
        )}
      </div>
    </div>
  );
};

const s = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' },
  modal: { background: '#fff', padding: '32px', borderRadius: '12px', width: '100%', maxWidth: '420px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' },
  header: { display: 'flex', justifyContent: 'space-between', marginBottom: '24px' },
  title: { margin: 0, fontSize: '20px', fontWeight: '700' },
  label: { fontSize: '11px', color: '#666', marginBottom: '4px', display: 'block' },
  contextBar: { background: '#f4f4f4', padding: '8px 12px', borderRadius: '4px', fontSize: '11px', marginBottom: '20px', color: '#666' },
  input: { width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #ccc', borderRadius: '6px', boxSizing: 'border-box' },
  fileInput: { width: '100%', padding: '12px', marginBottom: '20px' },
  btn: { width: '100%', padding: '14px', background: '#000', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' },
  btnSuccess: { width: '100%', padding: '14px', background: '#00ffcc', color: '#000', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' },
  info: { fontSize: '13px', color: '#555', marginBottom: '20px' },
  successBox: { textAlign: 'center', color: '#008000', padding: '20px' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }
};

export default KycModal;
