// Web Crypto API Native Encryption & Cryptographic Audit Ledger
// Standard AES-GCM-256 with PBKDF2 Key Derivation (100,000 rounds) & SHA-256 Ledger Verification

export interface SecurityStatus {
  isCryptoAvailable: boolean;
  isPinLockConfigured: boolean;
  isSessionLocked: boolean;
  autoLockMinutes: number;
  lastActiveTimestamp: number;
  failedPinAttempts: number;
  ledgerIntegrityVerified: boolean;
  ledgerTamperDetected: boolean;
  verifiedTradeCount: number;
  encryptionMode: "AES-256-GCM" | "OFFLINE_LOCAL";
}

export interface CryptographicTradeBlock {
  blockIndex: number;
  tradeId: string;
  asset: string;
  type: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  timestamp: number;
  previousHash: string;
  blockHash: string;
}

const PIN_HASH_STORAGE_KEY = "survival_bot_pin_hash_v1";
const PIN_SALT_STORAGE_KEY = "survival_bot_pin_salt_v1";
const AUTO_LOCK_STORAGE_KEY = "survival_bot_autolock_min";
const LEDGER_STORAGE_KEY = "survival_bot_audit_ledger_v1";
const LEGAL_TERMS_ACCEPTED_KEY = "survival_bot_legal_terms_ack_v1";

class CryptoSecurityService {
  private isLocked: boolean = false;
  private lastActivity: number = Date.now();
  private autoLockMinutes: number = 15;
  private failedAttempts: number = 0;

  constructor() {
    if (typeof window !== "undefined") {
      const savedAutoLock = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
      if (savedAutoLock) {
        this.autoLockMinutes = parseInt(savedAutoLock, 10) || 15;
      }
      // If PIN is configured, lock on initial app launch
      if (this.isPinConfigured()) {
        this.isLocked = true;
      }
    }
  }

  // --- Web Crypto Subtle Helpers ---
  public isWebCryptoAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      window.crypto &&
      !!window.crypto.subtle
    );
  }

  /**
   * Computes SHA-256 hex string of a text message
   */
  public async sha256(message: string): Promise<string> {
    if (!this.isWebCryptoAvailable()) {
      return this.fallbackHash(message);
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Derives an AES-GCM 256 key from a passphrase/PIN using PBKDF2 with 100,000 iterations
   */
  private async deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveBits", "deriveKey"]
    );

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt as unknown as BufferSource,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  /**
   * Encrypts plaintext string using AES-GCM-256
   */
  public async encrypt(plaintext: string, secretPass: string): Promise<string> {
    if (!this.isWebCryptoAvailable()) {
      return btoa(unescape(encodeURIComponent(plaintext)));
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.deriveKey(secretPass, salt);
    const encodedData = new TextEncoder().encode(plaintext);

    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      encodedData
    );

    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
    const cipherHex = Array.from(new Uint8Array(ciphertext))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return `${saltHex}:${ivHex}:${cipherHex}`;
  }

  /**
   * Decrypts AES-GCM-256 ciphertext payload
   */
  public async decrypt(encryptedPayload: string, secretPass: string): Promise<string> {
    if (!this.isWebCryptoAvailable() || !encryptedPayload.includes(":")) {
      try {
        return decodeURIComponent(escape(atob(encryptedPayload)));
      } catch {
        return encryptedPayload;
      }
    }
    const [saltHex, ivHex, cipherHex] = encryptedPayload.split(":");
    if (!saltHex || !ivHex || !cipherHex) throw new Error("Invalid cipher format");

    const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    const ciphertext = new Uint8Array(cipherHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

    const key = await this.deriveKey(secretPass, salt);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource
    );

    return new TextDecoder().decode(decryptedBuffer);
  }

  // --- PIN Lock & Physical Device Protection ---
  public isPinConfigured(): boolean {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem(PIN_HASH_STORAGE_KEY);
  }

  public async setPin(pin: string): Promise<boolean> {
    if (!pin || pin.length < 4) return false;
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const pinHash = await this.sha256(`${saltHex}:${pin}`);

    localStorage.setItem(PIN_SALT_STORAGE_KEY, saltHex);
    localStorage.setItem(PIN_HASH_STORAGE_KEY, pinHash);
    this.isLocked = false;
    this.failedAttempts = 0;
    return true;
  }

  public async verifyPin(enteredPin: string): Promise<boolean> {
    const saltHex = localStorage.getItem(PIN_SALT_STORAGE_KEY);
    const expectedHash = localStorage.getItem(PIN_HASH_STORAGE_KEY);
    if (!saltHex || !expectedHash) return true; // No PIN set

    const enteredHash = await this.sha256(`${saltHex}:${enteredPin}`);
    if (enteredHash === expectedHash) {
      this.isLocked = false;
      this.failedAttempts = 0;
      this.touchActivity();
      return true;
    } else {
      this.failedAttempts++;
      return false;
    }
  }

  public removePin(): void {
    localStorage.removeItem(PIN_SALT_STORAGE_KEY);
    localStorage.removeItem(PIN_HASH_STORAGE_KEY);
    this.isLocked = false;
    this.failedAttempts = 0;
  }

  public lockSession(): void {
    if (this.isPinConfigured()) {
      this.isLocked = true;
    }
  }

  public isSessionLocked(): boolean {
    if (!this.isPinConfigured()) return false;
    if (this.isLocked) return true;

    // Check auto-lock timer
    if (this.autoLockMinutes > 0) {
      const elapsedMinutes = (Date.now() - this.lastActivity) / (60 * 1000);
      if (elapsedMinutes >= this.autoLockMinutes) {
        this.isLocked = true;
        return true;
      }
    }
    return false;
  }

  public touchActivity(): void {
    this.lastActivity = Date.now();
  }

  public setAutoLockMinutes(min: number): void {
    this.autoLockMinutes = min;
    localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(min));
  }

  public getAutoLockMinutes(): number {
    return this.autoLockMinutes;
  }

  public getFailedAttempts(): number {
    return this.failedAttempts;
  }

  // --- Cryptographic Trade Audit Ledger (SHA-256 Block Chain) ---
  public async appendTradeToAuditLedger(trade: {
    id: string;
    asset: string;
    type: string;
    entryPrice: number;
    exitPrice: number;
    pnl: number;
    timestamp: number;
  }): Promise<CryptographicTradeBlock> {
    const ledger = this.getLedger();
    const prevBlock = ledger[ledger.length - 1];
    const prevHash = prevBlock ? prevBlock.blockHash : "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000";

    const blockIndex = ledger.length;
    const rawPayload = `${prevHash}|${blockIndex}|${trade.id}|${trade.asset}|${trade.type}|${trade.entryPrice}|${trade.exitPrice}|${trade.pnl}|${trade.timestamp}`;
    const blockHash = await this.sha256(rawPayload);

    const block: CryptographicTradeBlock = {
      blockIndex,
      tradeId: trade.id,
      asset: trade.asset,
      type: trade.type,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      timestamp: trade.timestamp,
      previousHash: prevHash,
      blockHash,
    };

    ledger.push(block);
    localStorage.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
    return block;
  }

  public getLedger(): CryptographicTradeBlock[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(LEDGER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  public async verifyLedgerIntegrity(): Promise<{
    isValid: boolean;
    tamperedIndex: number | null;
    verifiedCount: number;
  }> {
    const ledger = this.getLedger();
    if (ledger.length === 0) {
      return { isValid: true, tamperedIndex: null, verifiedCount: 0 };
    }

    let expectedPrevHash = "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < ledger.length; i++) {
      const block = ledger[i];
      if (block.previousHash !== expectedPrevHash) {
        return { isValid: false, tamperedIndex: i, verifiedCount: i };
      }

      const rawPayload = `${block.previousHash}|${block.blockIndex}|${block.tradeId}|${block.asset}|${block.type}|${block.entryPrice}|${block.exitPrice}|${block.pnl}|${block.timestamp}`;
      const recomputedHash = await this.sha256(rawPayload);

      if (recomputedHash !== block.blockHash) {
        return { isValid: false, tamperedIndex: i, verifiedCount: i };
      }

      expectedPrevHash = block.blockHash;
    }

    return { isValid: true, tamperedIndex: null, verifiedCount: ledger.length };
  }

  // --- Legal & Regulatory Compliance Acknowledgment ---
  public isLegalTermsAcknowledged(): boolean {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(LEGAL_TERMS_ACCEPTED_KEY) === "true";
  }

  public acknowledgeLegalTerms(): void {
    if (typeof window !== "undefined") {
      localStorage.setItem(LEGAL_TERMS_ACCEPTED_KEY, "true");
      localStorage.setItem("survival_bot_legal_terms_timestamp", String(Date.now()));
    }
  }

  // Internal deterministic hash fallback
  private fallbackHash(msg: string): string {
    let hash = 0;
    for (let i = 0; i < msg.length; i++) {
      const char = msg.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, "0");
  }
}

export const cryptoSecurityService = new CryptoSecurityService();
