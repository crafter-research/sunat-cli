import { describe, expect, test } from "bun:test";
import { NATIVE_SETTER } from "../../src/browser/cdp.ts";

describe("NATIVE_SETTER", () => {
	test("usa el setter nativo del prototipo, no asignación directa", () => {
		// Un `el.value = x` no dispara los handlers de jQuery Validate y el
		// formulario queda inerte: ese fue el bloqueo original del F616.
		expect(NATIVE_SETTER).toContain("getOwnPropertyDescriptor");
		expect(NATIVE_SETTER).toContain("HTMLInputElement.prototype");
	});

	test("despacha los cuatro eventos que el portal escucha", () => {
		for (const ev of ["input", "keyup", "change", "blur"]) {
			expect(NATIVE_SETTER).toContain(ev);
		}
	});

	test("distingue SELECT de INPUT", () => {
		// El catálogo de profesión es un <select>: su setter vive en otro prototipo.
		expect(NATIVE_SETTER).toContain("HTMLSelectElement.prototype");
	});

	test("señala el campo ausente en vez de fallar en silencio", () => {
		expect(NATIVE_SETTER).toContain("NO_FIELD");
	});
});

describe("conversión de periodo", () => {
	// El CLI recibe YYYY-MM (consistente con el resto de comandos) y el
	// formulario espera MM/AAAA.
	const aMMAAAA = (p: string): string => {
		const m = p.match(/^(\d{4})-(\d{2})$/);
		if (!m) throw new Error(`Periodo inválido: "${p}". Formato: YYYY-MM.`);
		return `${m[2]}/${m[1]}`;
	};

	test("2025-11 se convierte a 11/2025", () => {
		expect(aMMAAAA("2025-11")).toBe("11/2025");
	});

	test("conserva el cero inicial del mes", () => {
		expect(aMMAAAA("2026-01")).toBe("01/2026");
	});

	test("rechaza formatos que no son YYYY-MM", () => {
		for (const malo of ["11/2025", "2025-1", "202511", "", "2025-13-01"]) {
			expect(() => aMMAAAA(malo)).toThrow();
		}
	});
});

describe("partición del nombre del cliente", () => {
	// Con tipo de documento OTROS el portal bloquea Razón Social y exige
	// apellidos, así que el nombre se parte. El registro es válido igual.
	const partir = (cliente: string) => {
		const p = cliente.trim().split(/\s+/);
		return { apePat: p[0] || cliente, apeMat: p[1] || "", nombres: cliente };
	};

	test("dos palabras van a paterno y materno", () => {
		expect(partir("CLERK INC")).toEqual({ apePat: "CLERK", apeMat: "INC", nombres: "CLERK INC" });
	});

	test("una sola palabra deja el materno vacío", () => {
		expect(partir("ACME")).toEqual({ apePat: "ACME", apeMat: "", nombres: "ACME" });
	});

	test("nombres largos conservan el original completo", () => {
		const r = partir("GLOBAL SOFTWARE SOLUTIONS LLC");
		expect(r.apePat).toBe("GLOBAL");
		expect(r.apeMat).toBe("SOFTWARE");
		expect(r.nombres).toBe("GLOBAL SOFTWARE SOLUTIONS LLC");
	});

	test("tolera espacios de más", () => {
		expect(partir("  CLERK   INC  ").apePat).toBe("CLERK");
	});
});

describe("coherencia de mes entre fecha y periodo", () => {
	// SUNAT rechaza una fila cuyo mes de emisión o pago no coincide con el
	// periodo tributario abierto.
	const mesDe = (fecha: string) => fecha.slice(3);

	test("extrae MM/AAAA de una fecha DD/MM/AAAA", () => {
		expect(mesDe("17/11/2025")).toBe("11/2025");
		expect(mesDe("03/03/2026")).toBe("03/2026");
	});

	test("detecta el desajuste que SUNAT rechaza", () => {
		expect(mesDe("10/12/2025")).not.toBe("11/2025");
	});
});
