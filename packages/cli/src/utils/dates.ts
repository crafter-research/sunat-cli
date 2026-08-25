export function today(): string {
	return new Date().toISOString().split("T")[0];
}

export function todayDDMMYYYY(): string {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function periodoToSUNAT(periodo: string): string {
	const [year, month] = periodo.split("-");
	return `${month}-${year}`;
}

/**
 * Seconds into the phrase a person reads off a clock.
 *
 * An OAuth `expires_in` answers the protocol's question, not the reader's:
 * "3600" has to be divided before it means "this hour". Rounds down, because a
 * token shown as having a minute left while it expires in fifty seconds is the
 * direction of error worth avoiding.
 */
export function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "expired";

	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor((total % 3600) / 60);

	if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
	if (minutes > 0) return `${minutes}min`;
	return `${total}s`;
}

export function expandPeriodoRange(range: string): string[] {
	const [start, end] = range.split("..");
	if (!start || !end) throw new Error(`Invalid range: "${range}". Use YYYY-MM..YYYY-MM`);

	const [sy, sm] = start.split("-").map(Number);
	const [ey, em] = end.split("-").map(Number);
	const periodos: string[] = [];

	let y = sy;
	let m = sm;
	while (y < ey || (y === ey && m <= em)) {
		periodos.push(`${y}-${String(m).padStart(2, "0")}`);
		m++;
		if (m > 12) {
			m = 1;
			y++;
		}
	}
	return periodos;
}
