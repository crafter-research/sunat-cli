import { execFileSync } from "node:child_process";

export const KEYCHAIN_SERVICE = "sunat-cli";

export const SUPPORTED_SECRET_KEYS = [
	"CPE_CERT_PASSWORD",
	"CPE_SOL_PASSWORD",
	"SUNAT_PASSWORD",
	"SUNAT_API_CLIENT_SECRET",
	"SUNAT_GRE_CLIENT_SECRET",
] as const;

export interface KeychainEntry {
	key: string;
	exists: boolean;
}

function assertSecretKey(key: string): void {
	if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid secret key "${key}". Use an env-var-style name.`);
}

function commandUnavailable(err: unknown): boolean {
	const code = typeof err === "object" && err && "status" in err ? (err as { status?: number }).status : undefined;
	return code === 1 || code === 44 || code === 45;
}

function run(command: string, args: string[], input?: string): string {
	return execFileSync(command, args, {
		encoding: "utf-8",
		input,
		stdio: ["pipe", "pipe", "pipe"],
	}).trim();
}

function platformName(): string {
	if (process.platform === "darwin") return "macOS Keychain";
	if (process.platform === "linux") return "Linux Secret Service";
	if (process.platform === "win32") return "Windows credential storage";
	return process.platform;
}

export function keychainBackend(): "macos" | "linux" | "unsupported" {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "linux") return "linux";
	return "unsupported";
}

export function setKeychainSecret(key: string, value: string): void {
	assertSecretKey(key);
	if (!value) throw new Error("Secret value cannot be empty.");
	const backend = keychainBackend();
	if (backend === "macos") {
		run("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", key, "-w", value]);
		return;
	}
	if (backend === "linux") {
		run("secret-tool", ["store", "--label", `${KEYCHAIN_SERVICE} ${key}`, "service", KEYCHAIN_SERVICE, "account", key], value);
		return;
	}
	throw new Error(`${platformName()} is not supported yet.`);
}

export function getKeychainSecret(key: string): string | undefined {
	assertSecretKey(key);
	const backend = keychainBackend();
	try {
		if (backend === "macos") return run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"]) || undefined;
		if (backend === "linux") return run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", key]) || undefined;
		return undefined;
	} catch (err) {
		if (commandUnavailable(err)) return undefined;
		throw new Error(`Could not read ${key} from ${platformName()}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function clearKeychainSecret(key: string): boolean {
	assertSecretKey(key);
	const backend = keychainBackend();
	try {
		if (backend === "macos") {
			run("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key]);
			return true;
		}
		if (backend === "linux") {
			run("secret-tool", ["clear", "service", KEYCHAIN_SERVICE, "account", key]);
			return true;
		}
		throw new Error(`${platformName()} is not supported yet.`);
	} catch (err) {
		if (commandUnavailable(err)) return false;
		throw new Error(`Could not clear ${key} from ${platformName()}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export function listKeychainSecrets(keys: readonly string[] = SUPPORTED_SECRET_KEYS): KeychainEntry[] {
	return keys.map((key) => ({ key, exists: getKeychainSecret(key) !== undefined }));
}

export function resolveSecret(envNames: readonly string[]): string | undefined {
	for (const name of envNames) {
		const value = process.env[name];
		if (value) return value;
	}
	for (const name of envNames) {
		const value = getKeychainSecret(name);
		if (value) return value;
	}
	return undefined;
}

export function missingSecretMessage(envNames: readonly string[], label = "Secret"): string {
	return `${label} missing. Set ${envNames.join(" or ")} env var, or store it with: sunat keychain set ${envNames[0]} --value <secret>`;
}
