import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const LUKEA_DIR = join(process.env.HOME || "", ".lukea");
const CREDS_FILE = join(LUKEA_DIR, "credentials.json");

export interface LukeaCredentials {
	apiKey: string;
	apiUrl: string;
	email?: string;
	connectedAt: string;
}

export function loadLukeaCredentials(): LukeaCredentials | null {
	if (!existsSync(CREDS_FILE)) return null;
	return JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
}

export function saveLukeaCredentials(creds: LukeaCredentials): void {
	if (!existsSync(LUKEA_DIR)) mkdirSync(LUKEA_DIR, { recursive: true });
	writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}

export function deleteLukeaCredentials(): void {
	if (existsSync(CREDS_FILE)) unlinkSync(CREDS_FILE);
}

export function getLukeaClient(): { apiKey: string; apiUrl: string } {
	const creds = loadLukeaCredentials();
	if (!creds) throw new Error("Not connected to Lukea. Run: sunat lukea login");
	return { apiKey: creds.apiKey, apiUrl: creds.apiUrl };
}

export async function lukeaFetch(path: string, options?: RequestInit): Promise<Response> {
	const { apiKey, apiUrl } = getLukeaClient();
	return fetch(`${apiUrl}${path}`, {
		...options,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...options?.headers,
		},
	});
}
