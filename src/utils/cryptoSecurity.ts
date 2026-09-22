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
  encryptionMode: "AES-256-GCM" | "UNAVAILABLE";
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

const PIN_HASH_STORAGE_KEY = "jarvis_pin_verifier_v2";
const PIN_SALT_STORAGE_KEY = "jarvis_pin_salt_v2";
const AUTO_LOCK_STORAGE_KEY = "jarvis_autolock_min_v2";
const LEDGER_STORAGE_KEY = "jarvis_audit_ledger_v2";
const LEGAL_TERMS_ACCEPTED_KEY = "jarvis_terms_ack_v2";
const FAILED_ATTEMPTS_STORAGE_KEY = "jarvis_pin_failed_v2";
const LOCKOUT_UNTIL_STORAGE_KEY = "jarvis_pin_lockout_until_v2";

const PBKDF2_ITERATIONS = 310_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_BASE_MS = 15_000;

class CryptoSecurityService {
  private isLocked = false;
  private lastActivity = Date.now();
  private autoLockMinutes = 15;
  private failedAttempts = 0;

  constructor() {
    if (typeof window === "undefined") return;

    const savedAutoLock = localStorage.getItem(AUTO_LOCK_STORAGE_KEY);
    if (savedAutoLock) {
      const parsed = Number(savedAutoLock);
      if (Number.isFinite(parsed)) this.autoLockMinutes = Math.max(0, Math.min(120, parsed));
    }

    const savedFailures = Number(localStorage.getItem(FAILED_ATTEMPTS_STORAGE_KEY) || 0);
    this.failedAttempts = Number.isFinite(savedFailures) ? Math.max(0, savedFailures) : 0;
    this.isLocked = this.isPinConfigured();
  }

  public isWebCryptoAvailable(): boolean {
    return typeof window !== "undefined" && !!window.crypto?.subtle;
  }

  private requireCrypto(): SubtleCrypto {
    if (!this.isWebCryptoAvailable()) {
      throw new Error("Web Crypto API is unavailable. Refusing to create non-cryptographic fallback data.");
    }
    return window.crypto.subtle;
  }

  public async sha256(message: string): Promise<string> {
    const subtle = this.requireCrypto();
    const data = new TextEncoder().encode(message);
    const hashBuffer = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private async deriveBits(secret: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<ArrayBuffer> {
    const subtle = this.requireCrypto();
    const material = await subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    return subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      material,
      256,
    );
  }

  private toHex(bytes: Uint8Array): string {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  private fromHex(hex: string): Uint8Array {
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid hex payload.");
    return new Uint8Array((hex.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));
  }

  private constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  public async encrypt(plaintext: string, secretPass: string): Promise<string> {
    const subtle = this.requireCrypto();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const keyBits = await this.deriveBits(secretPass, salt);
    const key = await subtle.importKey("raw", keyBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
    return this.toHex(salt) + ":" + this.toHex(iv) + ":" + this.toHex(new Uint8Array(ciphertext));
  }

  public async decrypt(encryptedPayload: string, secretPass: string): Promise<string> {
    const subtle = this.requireCrypto();
    const parts = encryptedPayload.split(":");
    if (parts.length !== 3) throw new Error("Invalid AES-GCM payload.");
    const [saltHex, ivHex, cipherHex] = parts;
    const salt = this.fromHex(saltHex);
    const iv = this.fromHex(ivHex);
    const ciphertext = this.fromHex(cipherHex);
    const keyBits = await this.deriveBits(secretPass, salt);
    const key = await subtle.importKey("raw", keyBits, { name: "AES-GCM" }, false, ["decrypt"]);
    const decrypted = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  }

  public isPinConfigured(): boolean {
    return typeof window !== "undefined" && !!localStorage.getItem(PIN_HASH_STORAGE_KEY);
  }

  public async setPin(pin: string): Promise<boolean> {
    if (!/^\d{6}$/.test(pin)) return false;
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const verifier = await this.deriveBits(pin, salt);
    localStorage.setItem(PIN_SALT_STORAGE_KEY, this.toHex(salt));
    localStorage.setItem(PIN_HASH_STORAGE_KEY, this.toHex(new Uint8Array(verifier)));
    localStorage.setItem(FAILED_ATTEMPTS_STORAGE_KEY, "0");
    localStorage.removeItem(LOCKOUT_UNTIL_STORAGE_KEY);
    this.failedAttempts = 0;
    this.isLocked = false;
    return true;
  }

  private getLockoutUntil(): number {
    return Number(localStorage.getItem(LOCKOUT_UNTIL_STORAGE_KEY) || 0);
  }

  public async verifyPin(enteredPin: string): Promise<boolean> {
    if (!this.isPinConfigured()) return true;

    if (Date.now() < this.getLockoutUntil()) return false;

    const saltHex = localStorage.getItem(PIN_SALT_STORAGE_KEY);
    const expectedHex = localStorage.getItem(PIN_HASH_STORAGE_KEY);
    if (!saltHex || !expectedHex) return false;

    const derived = new Uint8Array(await this.deriveBits(enteredPin, this.fromHex(saltHex)));
    const expected = this.fromHex(expectedHex);

    if (this.constantTimeEqual(derived, expected)) {
      this.failedAttempts = 0;
      localStorage.setItem(FAILED_ATTEMPTS_STORAGE_KEY, "0");
      localStorage.removeItem(LOCKOUT_UNTIL_STORAGE_KEY);
      this.isLocked = false;
      this.touchActivity();
      return true;
    }

    this.failedAttempts += 1;
    localStorage.setItem(FAILED_ATTEMPTS_STORAGE_KEY, String(this.failedAttempts));

    if (this.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const exponent = Math.min(this.failedAttempts - MAX_FAILED_ATTEMPTS, 6);
      const lockout = LOCKOUT_BASE_MS * 2 ** exponent;
      localStorage.setItem(LOCKOUT_UNTIL_STORAGE_KEY, String(Date.now() + lockout));
    }
    return false;
  }

  public removePin(): void {
    localStorage.removeItem(PIN_SALT_STORAGE_KEY);
    localStorage.removeItem(PIN_HASH_STORAGE_KEY);
    localStorage.removeItem(FAILED_ATTEMPTS_STORAGE_KEY);
    localStorage.removeItem(LOCKOUT_UNTIL_STORAGE_KEY);
    this.isLocked = false;
    this.failedAttempts = 0;
  }

  public lockSession(): void {
    if (this.isPinConfigured()) this.isLocked = true;
  }

  public isSessionLocked(): boolean {
    if (!this.isPinConfigured()) return false;
    if (this.isLocked) return true;
    if (this.autoLockMinutes > 0 && (Date.now() - this.lastActivity) / 60_000 >= this.autoLockMinutes) {
      this.isLocked = true;
    }
    return this.isLocked;
  }

  public touchActivity(): void {
    this.lastActivity = Date.now();
  }

  public setAutoLockMinutes(min: number): void {
    const value = Math.max(0, Math.min(120, Math.floor(min)));
    this.autoLockMinutes = value;
    localStorage.setItem(AUTO_LOCK_STORAGE_KEY, String(value));
  }

  public getAutoLockMinutes(): number {
    return this.autoLockMinutes;
  }

  public getFailedAttempts(): number {
    return this.failedAttempts;
  }

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
    const previousHash =
      ledger[ledger.length - 1]?.blockHash ??
      "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000";
    const blockIndex = ledger.length;
    const payload =
      previousHash + "|" + blockIndex + "|" + trade.id + "|" + trade.asset + "|" + trade.type + "|" +
      trade.entryPrice + "|" + trade.exitPrice + "|" + trade.pnl + "|" + trade.timestamp;
    const blockHash = await this.sha256(payload);

    const block: CryptographicTradeBlock = {
      blockIndex,
      tradeId: trade.id,
      asset: trade.asset,
      type: trade.type,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      pnl: trade.pnl,
      timestamp: trade.timestamp,
      previousHash,
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
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
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
    if (ledger.length === 0) return { isValid: true, tamperedIndex: null, verifiedCount: 0 };

    let expectedPrevHash =
      "GENESIS_BLOCK_00000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < ledger.length; i += 1) {
      const block = ledger[i];
      if (block.previousHash !== expectedPrevHash) {
        return { isValid: false, tamperedIndex: i, verifiedCount: i };
      }

      const payload =
        block.previousHash + "|" + block.blockIndex + "|" + block.tradeId + "|" + block.asset + "|" +
        block.type + "|" + block.entryPrice + "|" + block.exitPrice + "|" + block.pnl + "|" + block.timestamp;
      const recomputed = await this.sha256(payload);
      if (recomputed !== block.blockHash) {
        return { isValid: false, tamperedIndex: i, verifiedCount: i };
      }
      expectedPrevHash = block.blockHash;
    }

    return { isValid: true, tamperedIndex: null, verifiedCount: ledger.length };
  }

  public isLegalTermsAcknowledged(): boolean {
    return typeof window !== "undefined" && localStorage.getItem(LEGAL_TERMS_ACCEPTED_KEY) === "true";
  }

  public acknowledgeLegalTerms(): void {
    if (typeof window !== "undefined") {
      localStorage.setItem(LEGAL_TERMS_ACCEPTED_KEY, "true");
      localStorage.setItem("jarvis_legal_terms_timestamp_v2", String(Date.now()));
    }
  }
}

export const cryptoSecurityService = new CryptoSecurityService();
