export type TranscriptSegment = {
	startSeconds: number;
	durationSeconds: number;
	text: string;
};

export type YouTubeReadResult = {
	videoId: string;
	url: string;
	title: string;
	author: string;
	lengthSeconds: number | null;
	language: string;
	captionKind: "manual" | "asr";
	segments: TranscriptSegment[];
	transcript: string;
	fetchedAt: string;
};

export class YouTubeReaderError extends Error {
	constructor(message: string, public readonly code: string) {
		super(message);
		this.name = "YouTubeReaderError";
	}
}
