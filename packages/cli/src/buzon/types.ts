export type BuzonKind = "message" | "notification";

export interface RawBuzonRow {
	codMensaje?: unknown;
	indEstado?: unknown;
	indDesta?: unknown;
	indUrg?: unknown;
	fecVigencia?: unknown;
	indTipmsj?: unknown;
	desAsunto?: unknown;
	fecEnvio?: unknown;
	fecPublica?: unknown;
	indAviso?: unknown;
	cantidadArchAdj?: unknown;
	codEtiqueta?: unknown;
	indMensaje?: unknown;
	codCarpeta?: unknown;
}

export interface RawBuzonPage {
	estadoRespuesta?: unknown;
	startPage?: unknown;
	endPage?: unknown;
	total?: unknown;
	records?: unknown;
	rows?: unknown;
}

export interface BuzonItem {
	id: string;
	messageCode: string;
	kind: BuzonKind;
	subject: string;
	sentAtObserved: string | null;
	publishedAtObserved: string | null;
	validUntilObserved: string | null;
	stateCodeObserved: string | null;
	urgentObserved: boolean;
	starredObserved: boolean;
	noticeObserved: boolean;
	attachmentCountObserved: number;
	folderCodeObserved: string | null;
	labelCodeObserved: string | null;
	newSincePrevious: boolean;
	sourceEndpoint: "listNotiMenPag";
}

export interface BuzonKindSummary {
	kind: BuzonKind;
	pagesFetched: number;
	observedCount: number;
	reportedTotalsObserved: number[];
	reportedRecordsObserved: number[];
	countMismatch: boolean;
}

export interface BuzonOverview {
	foldersObserved: number;
	alertsObserved: number;
}

export interface BuzonChanges {
	baselineCreated: boolean;
	newCount: number;
	knownCount: number;
	missingCount: number;
	totalCount: number;
}

export interface BuzonListResult {
	version: "1.0.0";
	fetchedAt: string;
	source: "SUNAT Buzón SOL legacy visor";
	readOnlyBoundary: "metadata-only";
	overview: BuzonOverview;
	summaries: BuzonKindSummary[];
	changes: BuzonChanges;
	items: BuzonItem[];
}

export interface StoredBuzonState extends BuzonListResult {}
