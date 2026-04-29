import { describe, expect, test } from "bun:test";
import { parseCdr } from "../../src/cpe/soap/cdr.ts";

const CDR_ACEPTADO = `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>20100070970-01-F001-1234</cbc:ID>
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>0</cbc:ResponseCode>
      <cbc:Description>La Factura numero F001-1234, ha sido aceptada</cbc:Description>
      <cbc:ReferenceID>F001-1234</cbc:ReferenceID>
    </cac:Response>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;

const CDR_RECHAZADO = `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>2335</cbc:ResponseCode>
      <cbc:Description>El xml no contiene firma</cbc:Description>
    </cac:Response>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;

const CDR_OBSERVADO = `<?xml version="1.0" encoding="UTF-8"?>
<ar:ApplicationResponse xmlns:ar="urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cac:DocumentResponse>
    <cac:Response>
      <cbc:ResponseCode>0</cbc:ResponseCode>
      <cbc:Description>aceptada con observaciones</cbc:Description>
      <cbc:Note>2007 - El dato ingresado es incorrecto</cbc:Note>
      <cbc:Note>3030 - El XML tiene caracteres extranios</cbc:Note>
    </cac:Response>
  </cac:DocumentResponse>
</ar:ApplicationResponse>`;

describe("parseCdr", () => {
	test("aceptado: code=0, accepted=true", () => {
		const cdr = parseCdr(CDR_ACEPTADO);
		expect(cdr.responseCode).toBe("0");
		expect(cdr.accepted).toBe(true);
		expect(cdr.description).toContain("aceptada");
		expect(cdr.referenceId).toBe("F001-1234");
		expect(cdr.notes).toEqual([]);
	});

	test("rechazado: code=2335, accepted=false", () => {
		const cdr = parseCdr(CDR_RECHAZADO);
		expect(cdr.responseCode).toBe("2335");
		expect(cdr.accepted).toBe(false);
		expect(cdr.description).toContain("firma");
	});

	test("observado: code=0 with notes, accepted=true", () => {
		const cdr = parseCdr(CDR_OBSERVADO);
		expect(cdr.responseCode).toBe("0");
		expect(cdr.accepted).toBe(true);
		expect(cdr.notes.length).toBe(2);
		expect(cdr.notes[0]).toContain("2007");
	});
});
