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
    ID = 'ID',
    CLASS = 'CLASS',
    START_DATE = 'START-DATE',
    DURATION = 'DURATION',
    END_DATE = 'END-DATE',
    END_ON_NEXT = 'END-ON-NEXT',
    PLANNED_DURATION = 'PLANNED-DURATION',
    SCTE35_OUT = 'SCTE35-OUT',
    SCTE35_IN = 'SCTE35-IN',
    SCTE35_CMD = 'SCTE35-CMD'
}
export function convertArrayBufferToHexString(buffer: ArrayBuffer) {
    return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function hexStringToUint8Array(hexString: string) {
    // remove the leading 0x
    hexString = hexString.replace(/^0x/, '');

    // ensure even number of characters
    if (hexString.length % 2 != 0) {
        // WARNING: expecting an even number of characters in the hexString
        return;
    }

    // check for some non-hex characters
    const bad = hexString.match(/[G-Z\s]/i);
    if (bad) {
        // WARNING: found non-hex characters
        return;
    }

    // split the string into pairs of octets
    const pairs = hexString.match(/[\dA-F]{2}/gi);
    if (!pairs) {
        return;
    }

    // convert the octets to integers
    const integers = pairs.map(function (s) {
        return parseInt(s, 16);
    });

    return new Uint8Array(integers);
}

export class SCTE35Handler {
    _defaultAdBreakDuration = 15 * 60;
    constructor(
        protected logger: ILogger,
    ) {}

    parseSCTE35(manifest: m3u8.Manifest) {
        const dateRangeFrames: InPlaylistFrame[] = [];

        manifest.dateRanges?.forEach((dateRange) => {
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

                const messageData =
                    dateRange[DateRangeAttributes.SCTE35_IN] ??
                    dateRange[DateRangeAttributes.SCTE35_OUT] ??
                    dateRange[DateRangeAttributes.SCTE35_CMD];
                if (messageData) {
                    dateRangeFrame.messageData = hexStringToUint8Array(messageData)?.buffer;

                }
                if (dateRangeFrame.messageData) {
                    const encodedString = convertArrayBufferToHexString(dateRangeFrame.messageData);
                    const scte35: SCTE35 = new SCTE35();
                    const section = scte35.parseFromHex(encodedString);
                    this.handleScte35Event(
                        section,
                        startDate.getTime() / 1000,
                        dateRangeFrame.plannedDuration ?? dateRangeFrame.duration ?? this._defaultAdBreakDuration,
                        dateRangeFrame.endDate ? dateRangeFrame.endDate?.getTime() / 1000 : undefined,
                        dateRangeFrame.id
                    );
                }

                dateRangeFrames.push(dateRangeFrame);
            } catch (error) {
                this.logger.log('daterange: failed to parse,', dateRange, 'error', error);
            }
        });

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