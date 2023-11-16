import * as m3u8 from 'm3u8-parser'
import { ILogger } from './Logger';
import { SCTE35 } from 'scte35';
import { ISpliceInfoSection, ISpliceInsertEvent, SpliceCommandType } from 'scte35/build/ISCTE35';
import { ISegmentationDescriptor, SegmentationTypeId, SpliceDescriptorTag } from 'scte35/build/descriptors';


export enum TimedMetadataTypes {
    /**
     * hls id3 and emsg
     */
    IN_BAND = 'inband',

    /**
     * hls daterange and dash eventstream
     */
    IN_PLAYLIST = 'inplaylist'
}

export interface BaseMetadataFrame {
    frameType: TimedMetadataTypes;
    id?: string;
    rawId?: string;
    startTime: number;
}

export interface InPlaylistFrame extends BaseMetadataFrame {
    customAttributes: Record<string, string | ArrayBuffer>;
    duration?: number;
    endDate?: Date;
    endOnNext?: boolean;
    frameType: TimedMetadataTypes.IN_PLAYLIST;
    messageData?: ArrayBuffer;
    plannedDuration?: number;
    schemeIdUri?: string;
    startDate: Date;
}

export enum DateRangeAttributes {
    ID = 'id',
    CLASS = 'class',
    START_DATE = 'startDate',
    DURATION = 'duration',
    END_DATE = 'endDate',
    END_ON_NEXT = 'endOnNext',
    PLANNED_DURATION = 'plannedDuration',
    SCTE35_OUT = 'scte35Out',
    SCTE35_IN = 'scte35In',
    SCTE35_CMD = 'scte35Cmd'
}

export type SCTE35Cue = {
    id?: string,
    start?: number | undefined,
    end?: number | undefined,
}
export class SCTE35Handler {
    _defaultAdBreakDuration = 15 * 60;
    constructor(
        protected logger: ILogger,
    ) {}

    parseSCTE35(manifest: m3u8.Manifest, scte35DataRange: SCTE35Cue[], scte35Cues: SCTE35Cue[]) {
        const dateRangeFrames: InPlaylistFrame[] = [];

        if (!Array.isArray(manifest.dateRanges)) {
            console.log(`RECEIVE M3U8, there is NO EXT-X-DATERANGE TAG`);
            return;
        }

        console.log(`RECEIVE M3U8, there is ${manifest.dateRanges.length} CUE in EXT-X-DATERANGE`)
        for (let i = 0; i < manifest.dateRanges.length; i++) {
            const dateRange = manifest.dateRanges[i];
            // SKIP scte35Cmd
            if (!(dateRange[DateRangeAttributes.SCTE35_IN] || dateRange[DateRangeAttributes.SCTE35_OUT])) {
                continue;
            }
            // console.log(`EXT-X-DATERANGE CUE:, ${JSON.stringify(dateRange, null, 2)}`)

            try {
                const startDate = new Date(dateRange[DateRangeAttributes.START_DATE]);
                const dateRangeFrame: InPlaylistFrame = {
                    frameType: TimedMetadataTypes.IN_PLAYLIST,
                    startTime: startDate.getTime() / 1000,
                    id: dateRange[DateRangeAttributes.ID],
                    startDate,
                    customAttributes: dateRange
                };
                if (dateRange[DateRangeAttributes.END_DATE]) {
                    dateRangeFrame.endDate = new Date(dateRange[DateRangeAttributes.END_DATE]);
                }
                if (dateRange[DateRangeAttributes.DURATION]) {
                    dateRangeFrame.duration = parseFloat(dateRange[DateRangeAttributes.DURATION]);
                }
                if (dateRange[DateRangeAttributes.PLANNED_DURATION]) {
                    dateRangeFrame.plannedDuration = parseFloat(dateRange[DateRangeAttributes.PLANNED_DURATION]);
                }

                if (!dateRangeFrame.endDate && dateRangeFrame.duration) {
                    dateRangeFrame.endDate = new Date(dateRangeFrame.startDate.getTime() + dateRangeFrame.duration * 1000);
                }
                if (dateRangeFrame.endDate && !dateRangeFrame.duration) {
                    dateRangeFrame.duration = (dateRangeFrame.endDate.getTime() - dateRangeFrame.startDate.getTime()) / 1000;
                }
                const startTime = startDate.getTime();
                const endTime = dateRangeFrame.endDate ? dateRangeFrame.endDate?.getTime() : undefined;

                const cue: SCTE35Cue = {
                    id: dateRangeFrame.id,
                    start: startTime,
                    end: endTime,
                }
                console.log(`SCTE-35: ${JSON.stringify(cue)} \r\n`);
                scte35DataRange.push(cue);
                if (false) {
                    const messageData =
                        dateRange[DateRangeAttributes.SCTE35_IN] ??
                        dateRange[DateRangeAttributes.SCTE35_OUT] ??
                        dateRange[DateRangeAttributes.SCTE35_CMD];
                    console.log(`SCTE35 Message RAW Data: ${messageData}`);
                    if (messageData) {
                        const scte35: SCTE35 = new SCTE35();
                        const section = scte35.parseFromHex(messageData);
                        console.log(`SCTE35 Message Data: ${JSON.stringify(section, null, 2)}`);

                        this.handleScte35Event(
                            section,
                            startTime,
                            dateRangeFrame.plannedDuration ?? dateRangeFrame.duration ?? this._defaultAdBreakDuration,
                            endTime,
                            dateRangeFrame.id
                        );
                    }
                }

                dateRangeFrames.push(dateRangeFrame);
            } catch (error) {
                this.logger.log('daterange: failed to parse,', dateRange, 'error', error);
            }
        }
        console.log(`Parse M3U8 Finish, there is ${dateRangeFrames.length} valid CUE in EXT-X-DATERANGE`)

        if (!Array.isArray(manifest.segments)) {
            console.log(`RECEIVE M3U8, there is NO Segment in M3U8`);
            return;
        }
        const cues: SCTE35Cue[] = [];
        for (let i = 0; i < manifest.segments.length; i++) {
            const segment = manifest.segments[i];
            const cueOut = segment.cueOut;
            const timestamp = segment.programDateTime;
            if (!timestamp) { // skip the segment without timestamp.
                continue;
            }
            const cueIn = segment.cueIn;
            const cueOutCont = segment.cueOutCont;
            // console.log(`segment Info: ${JSON.stringify(segment, null, 2)}`);
            if (Object.prototype.hasOwnProperty.call(segment, 'cueIn') || Object.prototype.hasOwnProperty.call(segment,'cueOut')) {
                console.log(`segment Cue Info: cue-out: ${cueOut}, cue-in: ${cueIn}, timestamp: ${timestamp}, cue-out-cont: ${cueOutCont}`);
                if (Object.prototype.hasOwnProperty.call(segment, 'cueOut')) {
                    cues.push({start: timestamp});
                }
                if (Object.prototype.hasOwnProperty.call(segment, 'cueIn')) {
                    cues.push({end: timestamp});
                }
            }
        }

        let cacheStart = 0;
        for (let i = 0; i < cues.length; i ++) {
            if (typeof cues[i].start === 'number') {
                cacheStart = cues[i].start!;
            }
            if (typeof cues[i].end === 'number') {
                scte35Cues.push({ start: cacheStart, end: cues[i].end });
                cacheStart = 0;
                continue;
            }
        }
        if (cacheStart) {
            scte35Cues.push({ start: cacheStart, end: Infinity });
            cacheStart = 0;
        }
       
        console.log(`Parse M3U8, cues: ${JSON.stringify(scte35Cues)}`);
    }
    
    private handleScte35Event(scte35Splice: ISpliceInfoSection, start: number, duration: number, end?: number, idFromManifest?: string) {
        switch (scte35Splice.spliceCommandType) {
            case SpliceCommandType.SPLICE_INSERT: {
                const spliceCommand = scte35Splice.spliceCommand as ISpliceInsertEvent;
                const id = idFromManifest ?? spliceCommand.spliceEventId.toString();
                if (spliceCommand.outOfNetworkIndicator) {
                    // cue-out
                    // duration may be Number.MAX_VALUE when no PLANNED-DURATION presents
                    const adBreakDuation =
                        typeof spliceCommand.breakDuration?.duration === 'number'
                            ? spliceCommand.breakDuration.duration / 90000
                            : Math.min(duration, this._defaultAdBreakDuration);
                    console.log(`CUE-OUT:  id: ${id}  Start:  ${start},  Duration: ${adBreakDuation}`)
                    // this._adUnitManager.addLiveMidrollAdUnit(start, id, adBreakDuation);
                } else {
                    // cue-in
                    // typeof end === 'number' && this._adUnitManager.updateLiveMidrollAdUnit(end, id);
                    console.log(`CUE-IN:  id: ${id}  Start:  ${start},  End: ${end}`)
                }
                break;
            }
            case SpliceCommandType.TIME_SIGNAL: {
                const segmentationDescriptor = scte35Splice.descriptors?.find(
                    (descriptor) => descriptor.spliceDescriptorTag === SpliceDescriptorTag.SEGMENTATION_DESCRIPTOR
                ) as ISegmentationDescriptor | undefined;
                if (segmentationDescriptor) {
                    switch (segmentationDescriptor.segmentationTypeId as number) {
                        case SegmentationTypeId.DISTRIBUTOR_ADVERTISEMENT_START:
                        case SegmentationTypeId.PROVIDER_ADVERTISEMENT_START:
                        case SegmentationTypeId.PROVIDER_PLACEMENT_OPPORTUNITY_START:
                        case SegmentationTypeId.DISTRIBUTOR_PLACEMENT_OPPORTUNITY_START:
                        // case SegmentationTypeId.BREAK_START:
                            // TODO: cue-out
                            break;
                        case SegmentationTypeId.DISTRIBUTOR_ADVERTISEMENT_END:
                        case SegmentationTypeId.PROVIDER_ADVERTISEMENT_END:
                        case SegmentationTypeId.PROVIDER_PLACEMENT_OPPORTUNITY_END:
                        case SegmentationTypeId.DISTRIBUTOR_PLACEMENT_OPPORTUNITY_END:
                        // case SegmentationTypeId.BREAK_END:
                            // TODO: cue-in
                            break;
                    }
                }
                break;
            }
        }
    }
}