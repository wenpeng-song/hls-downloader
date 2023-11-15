import { URL } from "url";
import { ChunksDownloader } from "./ChunksDownloader";
import { HttpHeaders } from "./http";
import { ILogger } from "./Logger";
import * as m3u8 from "m3u8-parser";

export class M3u8OnlyDownloader extends ChunksDownloader {
    public manifest?: m3u8.Manifest;
    constructor(
        logger: ILogger,
        playlistUrl: string,
        concurrency: number,
        maxRetries: number,
        segmentDirectory: string,
        httpHeaders?: HttpHeaders,
    ) {
        super(logger, playlistUrl, concurrency, maxRetries, segmentDirectory, httpHeaders);
    }

    protected async refreshPlayList(): Promise<void> {
        this.manifest = await this.loadPlaylist();
        const segments = this.manifest.segments!.map((s) => new URL(s.uri, this.playlistUrl).href);

        this.logger.log(`Total ${segments.length} segment(s)`);

        this.queue.onIdle().then(() => this.finished());
    }

    private finished(): void {
        this.logger.log("All segments received, stopping");
        this.resolve!();
    }
}
