declare module "m3u8-parser" {
    interface ManifestSegment {
        uri: string;
        duration: number,
        programDateTime?:  number,
        attributes: {},
        discontinuity?: number,
        timeline?: number,
        cueOut?: string,
        cueOutCont?: string,
        cueIn?: string,
    }

    interface ManifestPlaylist {
        attributes: { [key: string]: string | number };
        uri: string;
        timeline: number;
    }

    interface Manifest {
        dateRanges?: Record<string, string>[];
        targetDuration?: number;
        segments?: ManifestSegment[];
        playlists?: ManifestPlaylist[];
    }

    export class Parser {
        push(str: string): void;
        end(): void;
        manifest: Manifest;
    }
}