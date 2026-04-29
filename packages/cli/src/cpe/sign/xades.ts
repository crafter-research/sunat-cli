/**
 * XAdES-BES enveloped signature for SUNAT UBL 2.1 documents.
 *
 * Signs the entire Invoice document and embeds the <ds:Signature> inside
 * /Invoice/ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent.
 *
 * Uses xml-crypto for the canonicalization + signature math, node-forge for PFX loading.
 */

import { SignedXml } from "xml-crypto";
import { type LoadedCert, loadPfx, pemToBase64Cert } from "./cert-loader.ts";

export interface SignOptions {
	pfxPath: string;
	pfxPassword: string;
	signatureId?: string;
	keyInfoId?: string;
}

export interface SignedDocument {
	xml: string;
	cert: LoadedCert;
	signatureId: string;
}

export function signFacturaXml(unsignedXml: string, opts: SignOptions): SignedDocument {
	const cert = loadPfx(opts.pfxPath, opts.pfxPassword);
	const signatureId = opts.signatureId || "SignatureSP";
	const keyInfoId = opts.keyInfoId || "KeyInfo";

	const sig = new SignedXml({
		privateKey: cert.privateKeyPem,
		publicCert: cert.certificatePem,
		signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
		canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
		getKeyInfoContent: () => {
			const b64 = pemToBase64Cert(cert.certificatePem);
			return `<X509Data><X509Certificate>${b64}</X509Certificate></X509Data>`;
		},
	});

	sig.addReference({
		xpath: "/*",
		transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
		digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
	});

	sig.computeSignature(unsignedXml, {
		prefix: "ds",
		location: {
			reference:
				"//*[local-name(.)='Invoice']/*[local-name(.)='UBLExtensions']/*[local-name(.)='UBLExtension']/*[local-name(.)='ExtensionContent']",
			action: "append",
		},
		attrs: { Id: signatureId },
	});

	let signedXml = sig.getSignedXml();
	if (!signedXml.startsWith("<?xml")) {
		signedXml = `<?xml version="1.0" encoding="UTF-8"?>\n${signedXml}`;
	}

	return { xml: signedXml, cert, signatureId };
}
