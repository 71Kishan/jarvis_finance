// Local Web Crypto helpers and tamper-evident paper-trade journaling.
// Browser storage is not a secure custody layer and must not hold broker secrets.

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

const PIN_HASH_STORAGE_KEY = "jarvis_pin_hash_v2";
const PIN_SALT_STORAGE_KEY = "jarvis_pin_salt_v2";
const AUTO_LOCK_STORAGE_KEY = "jarvis_autolock_min_v2";
const LEDGER_STORAGE_KEY = "jarvis_paper_audit_ledger_v2";
const LEGAL_TERMS_ACCEPTED_KEY = "jarvis_legal_terms_ack_v2";
const PIN_FAILED_ATTEMPTS_KEY = "jarvis_pin_failed_attempts_v2";
const PIN_LOCKOUT_UNTIL_KEY = "jarvis_pin_lockout_until_v2";

class CryptoSecurityService {
  private isLocked: boolean = false;
  private lastActivity: number = Date.now();
  private autoLockMinutes: number = 15;
  private failedAttempts: number = 0;
  private pinLockoutUntil: number = 0;

  constructor() {
    if (typeof window !== "undefined") {
      const savedAutoLock = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
      if (savedAutoLock) {
        this.autoLockMinutes = parseInt(savedAutoLock, 10) || 15;
      }
      this.failedAttempts = Number(localStorage.getItem(PIN_FAILED_ATTEMPTS_KEY) || 0);
      this.pinLockoutUntil = Number(localStorage.getItem(PIN_LOCKOUT_UNTIL_KEY) || 0);

      // If PIN is configured, lock on initial app launch.
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
      throw new Error("Web Crypto is unavailable; refusing an insecure hash fallback.");
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
      throw new Error("Web Crypto is unavailable; refusing insecure plaintext/base64 fallback.");
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
      throw new Error("Web Crypto is unavailable or the payload is not valid AES-GCM ciphertext.");
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

  // --- PIN Lock & Local Device Session Protection ---
  public isPinConfigured(): boolean {
    if (typeof window === "undefined") return false;
    return !!localStorage.getItem(PIN_HASH_STORAGE_KEY);
  }

  public async setPin(pin: string): Promise<boolean> {
    if (!this.isWebCryptoAvailable() || !/^\d{6,}$/.test(pin)) return false;

    try {
      const salt = window.crypto.getRandomValues(new Uint8Array(16));
      const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
      const pinHash = await this.sha256(`${saltHex}:${pin}`);

      localStorage.setItem(PIN_SALT_STORAGE_KEY, saltHex);
      localStorage.setItem(PIN_HASH_STORAGE_KEY, pinHash);
      localStorage.removeItem(PIN_FAILED_ATTEMPTS_KEY);
      localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
      this.isLocked = false;
      this.failedAttempts = 0;
      this.pinLockoutUntil = 0;
      return true;
    } catch {
      return false;
    }
  }

  public async verifyPin(enteredPin: string): Promise<boolean> {
    const saltHex = localStorage.getItem(PIN_SALT_STORAGE_KEY);
    const expectedHash = localStorage.getItem(PIN_HASH_STORAGE_KEY);
    if (!saltHex || !expectedHash) return true;

    const now = Date.now();
    this.pinLockoutUntil = Number(localStorage.getItem(PIN_LOCKOUT_UNTIL_KEY) || this.pinLockoutUntil || 0);
    if (now < this.pinLockoutUntil) return false;

    try {
      const enteredHash = await this.sha256(`${saltHex}:${enteredPin}`);
      if (enteredHash === expectedHash) {
        this.isLocked = false;
        this.failedAttempts = 0;
        this.pinLockoutUntil = 0;
        localStorage.removeItem(PIN_FAILED_ATTEMPTS_KEY);
        localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
        this.touchActivity();
        return true;
      }
    } catch {
      return false;
    }

    this.failedAttempts += 1;
    localStorage.setItem(PIN_FAILED_ATTEMPTS_KEY, String(this.failedAttempts));

    if (this.failedAttempts >= 5) {
      const delayMs = Math.min(15 * 60 * 1000, 30 * 1000 * 2 ** (this.failedAttempts - 5));
      this.pinLockoutUntil = now + delayMs;
      localStorage.setItem(PIN_LOCKOUT_UNTIL_KEY, String(this.pinLockoutUntil));
    }

    return false;
  }

  public removePin(): void {
    localStorage.removeItem(PIN_SALT_STORAGE_KEY);
    localStorage.removeItem(PIN_HASH_STORAGE_KEY);
    this.isLocked = false;
    this.failedAttempts = 0;
    this.pinLockoutUntil = 0;
    localStorage.removeItem(PIN_FAILED_ATTEMPTS_KEY);
    localStorage.removeItem(PIN_LOCKOUT_UNTIL_KEY);
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

  // --- Tamper-evident paper-trade journal (SHA-256 chained records) ---
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

  // --- App acknowledgement record ---
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

  // No insecure deterministic hash fallback is provided.
  private fallbackHash(_msg: string): string {
    throw new Error("Web Crypto is unavailable; no fallback hash is permitted.");

}

export const cryptoSecurityService = new CryptoSecurityService();
