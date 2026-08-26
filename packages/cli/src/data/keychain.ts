import { execFileSync } from "node:child_process";
import { privateChildEnv } from "./child-process.ts";

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

const WINDOWS_CREDENTIAL_SCRIPT = `
$source = @'
using System;
using System.Runtime.InteropServices;

public static class SunatCredentialManager
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = false)]
    public static extern void CredFree(IntPtr credential);
}
'@

Add-Type -TypeDefinition $source
$action = "__ACTION__"
$target = "__TARGET__"

if ($action -eq "set") {
    $secret = [Console]::In.ReadToEnd()
    $bytes = [Text.Encoding]::Unicode.GetBytes($secret)
    $blob = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
    try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)
        $credential = [SunatCredentialManager+Credential]::new()
        $credential.Type = 1
        $credential.TargetName = $target
        $credential.CredentialBlobSize = $bytes.Length
        $credential.CredentialBlob = $blob
        $credential.Persist = 2
        $credential.UserName = $target
        if (-not [SunatCredentialManager]::CredWrite([ref]$credential, 0)) { exit 2 }
    } finally {
        if ($bytes.Length -gt 0) {
            $zeros = [byte[]]::new($bytes.Length)
            [Runtime.InteropServices.Marshal]::Copy($zeros, 0, $blob, $zeros.Length)
        }
        [Runtime.InteropServices.Marshal]::FreeCoTaskMem($blob)
    }
    exit 0
}

if ($action -eq "get") {
    $pointer = [IntPtr]::Zero
    if (-not [SunatCredentialManager]::CredRead($target, 1, 0, [ref]$pointer)) {
        if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 1 }
        exit 2
    }
    try {
        $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][SunatCredentialManager+Credential])
        [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni($credential.CredentialBlob, $credential.CredentialBlobSize / 2))
    } finally {
        [SunatCredentialManager]::CredFree($pointer)
    }
    exit 0
}

if ($action -eq "clear") {
    if (-not [SunatCredentialManager]::CredDelete($target, 1, 0)) {
        if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 1168) { exit 1 }
        exit 2
    }
    exit 0
}

exit 2
`;

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
		env: privateChildEnv(process.env, [], ["SUNAT_TEST_"]),
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

export function keychainBackend(): "macos" | "linux" | "windows" | "unsupported" {
	if (process.platform === "darwin") return "macos";
	if (process.platform === "linux") return "linux";
	if (process.platform === "win32") return "windows";
	return "unsupported";
}

function windowsCredential(action: "set" | "get" | "clear", key: string, input?: string): string {
	const script = WINDOWS_CREDENTIAL_SCRIPT.replace("__ACTION__", action).replace(
		"__TARGET__",
		`${KEYCHAIN_SERVICE}/${key}`,
	);
	const encoded = Buffer.from(script, "utf16le").toString("base64");
	return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], input);
}

export function setKeychainSecret(key: string, value: string): void {
	assertSecretKey(key);
	if (!value) throw new Error("Secret value cannot be empty.");
	if (/[\r\n]/.test(value)) throw new Error("Secret value cannot contain line breaks.");
	if (value.includes("\0")) throw new Error("Secret value cannot contain null bytes.");
	const backend = keychainBackend();
	try {
		if (backend === "macos") {
			run("security", ["add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"], `${value}\n${value}\n`);
			return;
		}
		if (backend === "linux") {
			run(
				"secret-tool",
				["store", "--label", `${KEYCHAIN_SERVICE} ${key}`, "service", KEYCHAIN_SERVICE, "account", key],
				value,
			);
			return;
		}
		if (backend === "windows") {
			windowsCredential("set", key, value);
			return;
		}
		throw new Error(`${platformName()} is not supported yet.`);
	} catch {
		throw new Error(`Could not store ${key} in ${platformName()}.`);
	}
}

export function getKeychainSecret(key: string): string | undefined {
	assertSecretKey(key);
	const backend = keychainBackend();
	try {
		if (backend === "macos")
			return run("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key, "-w"]) || undefined;
		if (backend === "linux")
			return run("secret-tool", ["lookup", "service", KEYCHAIN_SERVICE, "account", key]) || undefined;
		if (backend === "windows") return windowsCredential("get", key) || undefined;
		return undefined;
	} catch (err) {
		if (commandUnavailable(err)) return undefined;
		throw new Error(`Could not read ${key} from ${platformName()}.`);
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
		if (backend === "windows") {
			windowsCredential("clear", key);
			return true;
		}
		throw new Error(`${platformName()} is not supported yet.`);
	} catch (err) {
		if (commandUnavailable(err)) return false;
		throw new Error(`Could not clear ${key} from ${platformName()}.`);
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
	return `${label} missing. Set ${envNames.join(" or ")} env var, or store it with: sunat-cli keychain set ${envNames[0]}`;
}
