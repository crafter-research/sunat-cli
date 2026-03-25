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
