import { lukeaFetch } from "../../data/lukea-config.ts";

export interface LukeaConnection {
	id: string;
	ruc: string;
	email?: string;
}

export interface LukeaJob {
	id: string;
	type: string;
	periodo: string;
	status: string;
	input?: Record<string, unknown>;
	result?: Record<string, unknown>;
}

export interface LukeaMe {
	email: string;
}

export async function getMe(): Promise<LukeaMe> {
	const res = await lukeaFetch("/api/me");
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json() as Promise<LukeaMe>;
}

export async function getConnections(): Promise<LukeaConnection[]> {
	const res = await lukeaFetch("/api/ruc");
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json() as Promise<LukeaConnection[]>;
}

export async function getJobs(): Promise<LukeaJob[]> {
	const res = await lukeaFetch("/api/jobs");
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json() as Promise<LukeaJob[]>;
}

export async function getJob(id: string): Promise<LukeaJob> {
	const res = await lukeaFetch(`/api/jobs/${id}`);
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json() as Promise<LukeaJob>;
}

export async function updateJob(id: string, data: Record<string, unknown>): Promise<LukeaJob> {
	const res = await lukeaFetch(`/api/jobs/${id}`, {
		method: "PATCH",
		body: JSON.stringify(data),
	});
	if (!res.ok) throw new Error(`API error: ${res.status}`);
	return res.json() as Promise<LukeaJob>;
}
