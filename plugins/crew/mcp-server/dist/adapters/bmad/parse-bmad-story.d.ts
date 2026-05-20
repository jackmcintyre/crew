import type { SourceStory } from "../adapter.js";
import { mapBmadStatusToExecution, type BmadStatus } from "./map-bmad-status.js";
/**
 * Pure BMad story parser — no I/O. The caller (the adapter's
 * `listSourceStories`/`readSourceStory`) is responsible for reading the
 * file and passing the bytes in.
 *
 * See {@link plugins/crew/docs/spikes/bmad-format.md} for the source
 * shape this parser handles.
 */
export declare function parseBmadStory(absPath: string, fileContents: string): SourceStory;
export declare function shouldSkipBmadStatus(status: BmadStatus): boolean;
export { mapBmadStatusToExecution };
