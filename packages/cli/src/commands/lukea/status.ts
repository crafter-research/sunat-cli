import { Command } from "commander";
import { getMe } from "./api-client.ts";
import { outputError } from "../../utils/output.ts";
import * as p from "@clack/prompts";

function formatPEN(amount: number): string {
	return `S/${amount.toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function createLukeaStatusCommand(): Command {
	return new Command("status")
		.description("Diagnostico fiscal desde Lukea")
		.action(async (_opts, cmd) => {
			const format = cmd.parent?.parent?.opts().output || "table";
			const isTTY = process.stdout.isTTY && format !== "json";

			try {
				const spinner = isTTY ? p.spinner() : null;
				spinner?.start("Consultando Lukea...");

				const me = await getMe();

				spinner?.stop();

				if (format === "json") {
					console.log(JSON.stringify(me, null, 2));
					return;
				}

				console.log();
				console.log(`  \x1b[1mDIAGNOSTICO FISCAL\x1b[0m`);
				console.log();

				if (me.connections.length === 0) {
					console.log("  \x1b[2mNo hay RUC conectado.\x1b[0m");
					console.log();
					console.log("  Conecta tu RUC en lukea.ai/connect");
					console.log("  o ejecuta: sunat-cli lukea login");
					console.log();
					return;
				}

				for (const conn of me.connections) {
					const status = conn.isActive
						? "\x1b[32mactivo\x1b[0m"
						: "\x1b[2minactivo\x1b[0m";
					console.log(`  RUC \x1b[1m${conn.ruc}\x1b[0m · ${conn.usuario} · ${status}`);
				}

				console.log();

				if (me.pendingPeriods > 0) {
					console.log(`  Deuda total      \x1b[31m${formatPEN(me.totalDebt)}\x1b[0m`);
					console.log(`  Periodos          \x1b[33m${me.pendingPeriods} pendientes\x1b[0m`);
				} else {
					console.log("  \x1b[32mTodo al dia. No hay periodos pendientes.\x1b[0m");
				}

				console.log();

				if (me.pendingPeriods > 0) {
					console.log("  \x1b[2mSiguiente paso:\x1b[0m sunat-cli lukea jobs list");
				}

				console.log();
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				outputError(msg, format);
			}
		});
}
