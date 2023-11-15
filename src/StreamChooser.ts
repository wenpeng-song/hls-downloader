import * as m3u8 from "m3u8-parser";
import { URL } from "url";
import { get, getWithRetries, HttpHeaders } from "./http";
import { ILogger } from "./Logger";

export class StreamChooser {
    public manifest?: m3u8.Manifest;

    constructor(
        private logger: ILogger,
        private streamUrl: string,
        protected maxRetries?: number,
        private httpHeaders?: HttpHeaders,
    ) {}

    public async load(): Promise<boolean> {
        const response = await getWithRetries(this.streamUrl, this.httpHeaders, this.maxRetries);

        const parser = new m3u8.Parser();
        parser.push(response);
        parser.end();

        this.manifest = parser.manifest;

        return (this.manifest.segments && this.manifest.segments.length > 0)
            || (this.manifest.playlists && this.manifest.playlists.length > 0)
            || false;
    }

    public isMaster(): boolean {
        if (!this.manifest) {
            throw Error("You need to call 'load' before 'isMaster'");
        }

        return this.manifest.playlists && this.manifest.playlists.length > 0 || false;
    }

    public isPlaylist(): boolean {
        if (!this.manifest) {
            throw Error("You need to call 'load' before 'isMaster'");
        }
        return (!!this.manifest.segments && this.manifest.segments.length > 0);
    }

    public getPlaylistUrl(maxBandwidth?: "worst" | "best" | number): string | false {
        if (!this.manifest) {
            throw Error("You need to call 'load' before 'getPlaylistUrl'");
        }

        // If we already provided a playlist URL
        if (this.manifest.segments && this.manifest.segments.length > 0) {
            return this.streamUrl;
        }

        // You need a quality parameter with a master playlist
        if (!maxBandwidth) {
            this.logger.error("You need to provide a quality with a master playlist");
            return false;
        }

        // Find the most relevant playlist
        if (this.manifest.playlists && this.manifest.playlists.length > 0) {
            let compareFn: (prev: m3u8.ManifestPlaylist, current: m3u8.ManifestPlaylist) => m3u8.ManifestPlaylist;
            if (maxBandwidth === "best") {
                compareFn = (prev, current) => (prev.attributes.BANDWIDTH > current.attributes.BANDWIDTH) ? prev : current;
            } else if (maxBandwidth === "worst") {
                compareFn = (prev, current) => (prev.attributes.BANDWIDTH > current.attributes.BANDWIDTH) ? current : prev;
            } else {
                compareFn = (prev, current) => (prev.attributes.BANDWIDTH > current.attributes.BANDWIDTH || current.attributes.BANDWIDTH as number > maxBandwidth) ? prev : current;
            }
            const uri = this.manifest.playlists.reduce(compareFn).uri;
            return new URL(uri, this.streamUrl).href;
        }

        this.logger.error("No stream or playlist found in URL:", this.streamUrl);
        return false;
    }
}
