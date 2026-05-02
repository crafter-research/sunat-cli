import { Command } from "commander";
import { clearKeychainSecret, getKeychainSecret, listKeychainSecrets, setKeychainSecret } from "../data/keychain.ts";
import { output, outputError } from "../utils/output.ts";

type Format = "json" | "table" | "auto";

function getFormat(cmd: Command): Format {
	let parent: Command | null = cmd;
	while (parent) {
		const opts = parent.opts();
		if (opts.output) return opts.output as Format;
		parent = parent.parent;
	}
	return "auto";
}

export function createKeychainCommand(): Command {
	const keychain = new Command("keychain").description("Manage OS keychain secrets used by sunat-cli.");

	keychain
		.command("set")
		.description("Store a secret in the OS keychain.")
		.argument("<key>", "Secret env var name, e.g. CPE_CERT_PASSWORD")
		.requiredOption("--value <secret>", "Secret value")
		.action((key, opts, cmd) => {
			const format = getFormat(cmd);
			try {
				setKeychainSecret(key, opts.value);
				output(format, {
					json: { success: true, key },
					table: { headers: ["Key", "Status"], rows: [[key, "stored"]] },
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	keychain
		.command("get")
		.description("Read a secret from the OS keychain.")
		.argument("<key>", "Secret env var name, e.g. CPE_CERT_PASSWORD")
		.action((key, _opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const value = getKeychainSecret(key);
				if (!value) {
					outputError(`${key} not found in keychain.`, format);
					return;
				}
				if (format === "json") {
					output(format, { json: { key, value } });
				} else {
					console.log(value);
				}
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	keychain
		.command("list")
		.description("List supported secret keys and whether they exist in the OS keychain.")
		.action((_, cmd) => {
			const format = getFormat(cmd);
			try {
				const entries = listKeychainSecrets();
				output(format, {
					json: entries,
					table: {
						headers: ["Key", "Status"],
						rows: entries.map((entry) => [entry.key, entry.exists ? "stored" : "missing"]),
					},
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	keychain
		.command("clear")
		.description("Remove a secret from the OS keychain.")
		.argument("<key>", "Secret env var name, e.g. CPE_CERT_PASSWORD")
		.action((key, _opts, cmd) => {
			const format = getFormat(cmd);
			try {
				const cleared = clearKeychainSecret(key);
				output(format, {
					json: { success: true, key, cleared },
					table: { headers: ["Key", "Status"], rows: [[key, cleared ? "cleared" : "missing"]] },
				});
			} catch (err) {
				outputError(err instanceof Error ? err.message : String(err), format);
			}
		});

	return keychain;
}
