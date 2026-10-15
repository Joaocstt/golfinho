// Cofre do sistema (libsecret/GNOME Keyring, Keychain no macOS) via Electron safeStorage.
// Quem recebe o cofre é o chamador: aqui só descrevemos o contrato, para testar sem Electron.
export interface Vault {
  available(): boolean;
  encrypt(text: string): string;
  decrypt(body: string): string;
}
export function vaultFrom(safeStorage: {
  isEncryptionAvailable(): boolean;
  encryptString(text: string): Buffer;
  decryptString(buffer: Buffer): string;
}): Vault {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (body) => safeStorage.decryptString(Buffer.from(body, "base64")),
  };
}
