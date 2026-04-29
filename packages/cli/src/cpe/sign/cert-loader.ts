import { readFileSync } from "fs";
import forge from "node-forge";

export interface LoadedCert {
	privateKeyPem: string;
	certificatePem: string;
	subject: string;
	issuer: string;
	validFrom: Date;
	validTo: Date;
	serialNumber: string;
}

export function loadPfx(pfxPath: string, password: string): LoadedCert {
	const pfxBuffer = readFileSync(pfxPath);
	const p12Asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfxBuffer.toString("binary")));
	const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

	const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag];
	if (!keyBags || keyBags.length === 0) {
		throw new Error("No private key found in PFX. Wrong password?");
	}
	const privateKey = keyBags[0].key;
	if (!privateKey) throw new Error("Private key bag has no key");

	const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag];
	if (!certBags || certBags.length === 0) {
		throw new Error("No certificate found in PFX");
	}
	const cert = certBags[0].cert;
	if (!cert) throw new Error("Certificate bag has no cert");

	const privateKeyPem = forge.pki.privateKeyToPem(privateKey);
	const certificatePem = forge.pki.certificateToPem(cert);

	return {
		privateKeyPem,
		certificatePem,
		subject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
		issuer: cert.issuer.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
		validFrom: cert.validity.notBefore,
		validTo: cert.validity.notAfter,
		serialNumber: cert.serialNumber,
	};
}

export function pemToBase64Cert(pem: string): string {
	return pem
		.replace(/-----BEGIN CERTIFICATE-----/g, "")
		.replace(/-----END CERTIFICATE-----/g, "")
		.replace(/\r?\n/g, "")
		.trim();
}
