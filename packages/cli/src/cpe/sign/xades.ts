/**
 * XAdES-BES enveloped signature for SUNAT UBL 2.1 documents.
 *
 * Manual implementation (not xml-crypto-driven) because xml-crypto v6 has
 * issues with enveloped signatures inside a referenced ancestor.
 *
 * Algorithm:
 * 1. Parse doc, find ExtensionContent, ensure empty.
 * 2. Insert ds:Signature stub (empty SignedInfo, empty SignatureValue, KeyInfo) into ExtensionContent.
 * 3. Compute digest of doc canonicalized with enveloped-signature transform applied
 *    (which removes the ds:Signature subtree before c14n).
 * 4. Fill in DigestValue inside SignedInfo.
 * 5. Canonicalize SignedInfo (in-context, with namespaces inherited from ancestors).
 * 6. RSA-SHA1 sign canonical SignedInfo with private key.
 * 7. Fill in SignatureValue.
 */

import { createSign, createHash } from "crypto";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { C14nCanonicalization } from "xml-crypto/lib/c14n-canonicalization.js";
import { type LoadedCert, loadPfx, pemToBase64Cert } from "./cert-loader.ts";

export interface SignOptions {
	pfxPath: string;
	pfxPassword: string;
	signatureId?: string;
}

export interface SignedDocument {
	xml: string;
	cert: LoadedCert;
	signatureId: string;
}

const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
const EXT_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";

export function signFacturaXml(unsignedXml: string, opts: SignOptions): SignedDocument {
	const cert = loadPfx(opts.pfxPath, opts.pfxPassword);
	const signatureId = opts.signatureId || "SignatureSP";
	const certB64 = pemToBase64Cert(cert.certificatePem);

	const doc = new DOMParser().parseFromString(unsignedXml, "text/xml");
	const extContent = findExtensionContent(doc);
	while (extContent.firstChild) extContent.removeChild(extContent.firstChild);

	// Build the full Signature element with placeholders for DigestValue + SignatureValue.
	const signatureEl = createSignatureSkeleton(doc, signatureId, certB64);
	extContent.appendChild(signatureEl);

	// Step A: digest of the document with enveloped-signature transform applied.
	const digestValue = computeEnvelopedDigest(doc, signatureEl);
	const digestValueNode = signatureEl.getElementsByTagNameNS(DS_NS, "DigestValue")[0];
	digestValueNode.appendChild(doc.createTextNode(digestValue));

	// Step B: canonicalize SignedInfo in-context, RSA-SHA1 sign.
	// Pass ancestor namespaces so xml-c14n produces the same bytes SUNAT will recanonicalize.
	const signedInfo = signatureEl.getElementsByTagNameNS(DS_NS, "SignedInfo")[0];
	const ancestorNs = collectAncestorNamespaces(signedInfo);
	const c14nSignedInfo = canonicalize(signedInfo, ancestorNs);
	const signatureValue = rsaSha1SignBase64(c14nSignedInfo, cert.privateKeyPem);

	const signatureValueNode = signatureEl.getElementsByTagNameNS(DS_NS, "SignatureValue")[0];
	signatureValueNode.appendChild(doc.createTextNode(signatureValue));

	let signedXml = new XMLSerializer().serializeToString(doc);
	if (!signedXml.startsWith("<?xml")) {
		signedXml = `<?xml version="1.0" encoding="UTF-8"?>\n${signedXml}`;
	}

	return { xml: signedXml, cert, signatureId };
}

function createSignatureSkeleton(doc: Document, signatureId: string, certB64: string): Element {
	// We use createElementNS so xmldom tracks namespaces correctly.
	const sig = doc.createElementNS(DS_NS, "ds:Signature");
	sig.setAttribute("Id", signatureId);

	const signedInfo = doc.createElementNS(DS_NS, "ds:SignedInfo");
	const canonMethod = doc.createElementNS(DS_NS, "ds:CanonicalizationMethod");
	canonMethod.setAttribute("Algorithm", "http://www.w3.org/TR/2001/REC-xml-c14n-20010315");
	const sigMethod = doc.createElementNS(DS_NS, "ds:SignatureMethod");
	sigMethod.setAttribute("Algorithm", "http://www.w3.org/2000/09/xmldsig#rsa-sha1");
	const reference = doc.createElementNS(DS_NS, "ds:Reference");
	reference.setAttribute("URI", "");
	const transforms = doc.createElementNS(DS_NS, "ds:Transforms");
	const transform = doc.createElementNS(DS_NS, "ds:Transform");
	transform.setAttribute("Algorithm", "http://www.w3.org/2000/09/xmldsig#enveloped-signature");
	transforms.appendChild(transform);
	const digestMethod = doc.createElementNS(DS_NS, "ds:DigestMethod");
	digestMethod.setAttribute("Algorithm", "http://www.w3.org/2000/09/xmldsig#sha1");
	const digestValue = doc.createElementNS(DS_NS, "ds:DigestValue");

	reference.appendChild(transforms);
	reference.appendChild(digestMethod);
	reference.appendChild(digestValue);
	signedInfo.appendChild(canonMethod);
	signedInfo.appendChild(sigMethod);
	signedInfo.appendChild(reference);
	sig.appendChild(signedInfo);

	const sigValue = doc.createElementNS(DS_NS, "ds:SignatureValue");
	sig.appendChild(sigValue);

	const keyInfo = doc.createElementNS(DS_NS, "ds:KeyInfo");
	const x509Data = doc.createElementNS(DS_NS, "ds:X509Data");
	const x509Cert = doc.createElementNS(DS_NS, "ds:X509Certificate");
	x509Cert.appendChild(doc.createTextNode(certB64));
	x509Data.appendChild(x509Cert);
	keyInfo.appendChild(x509Data);
	sig.appendChild(keyInfo);

	return sig;
}

function computeEnvelopedDigest(doc: Document, signatureEl: Element): string {
	// Clone the doc, remove the signature, then canonicalize.
	const clone = new DOMParser().parseFromString(new XMLSerializer().serializeToString(doc), "text/xml");
	const sigInClone = clone.getElementsByTagNameNS(DS_NS, "Signature")[0];
	if (sigInClone?.parentNode) sigInClone.parentNode.removeChild(sigInClone);
	const c14n = canonicalize(clone.documentElement);
	return sha1Base64(c14n);
}

function findExtensionContent(doc: Document): Element {
	const ext = doc.getElementsByTagNameNS(EXT_NS, "ExtensionContent");
	if (ext.length === 0) throw new Error("UBL document missing ext:ExtensionContent placeholder");
	return ext[0] as Element;
}

const c14n = new C14nCanonicalization();

function canonicalize(node: Node | Element, ancestorNamespaces: Array<{ prefix: string; namespaceURI: string }> = []): string {
	// biome-ignore lint/suspicious/noExplicitAny: xml-crypto types don't match xmldom types but runtime is compatible
	return c14n.process(node as any, { ancestorNamespaces }) as string;
}

function collectAncestorNamespaces(node: Element): Array<{ prefix: string; namespaceURI: string }> {
	const namespaces: Array<{ prefix: string; namespaceURI: string }> = [];
	const seen = new Set<string>();
	let current: Node | null = node.parentNode;
	while (current && current.nodeType === 1) {
		const el = current as Element;
		if (el.attributes) {
			for (let i = 0; i < el.attributes.length; i++) {
				const attr = el.attributes[i];
				if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
					const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
					if (!seen.has(prefix)) {
						seen.add(prefix);
						namespaces.push({ prefix, namespaceURI: attr.value });
					}
				}
			}
		}
		current = current.parentNode;
	}
	return namespaces;
}

function sha1Base64(data: string): string {
	return createHash("sha1").update(data, "utf8").digest("base64");
}

function rsaSha1SignBase64(data: string, privateKeyPem: string): string {
	const signer = createSign("RSA-SHA1");
	signer.update(data, "utf8");
	signer.end();
	return signer.sign(privateKeyPem, "base64");
}
