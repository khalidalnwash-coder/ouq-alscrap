// Real content-type detection from a file's actual bytes (magic numbers),
// independent of whatever Content-Type the uploading client claims — a
// client-supplied mimetype is just a request header the uploader fully
// controls (security review item 4: an HTML/JS payload was accepted and
// served back as if it were a real video once disguised this way).
//
// `file-type` is ESM-only, so it's loaded via a cached dynamic import from
// this otherwise-CommonJS codebase rather than require().
let fileTypeModulePromise;
function loadFileType() {
  if (!fileTypeModulePromise) fileTypeModulePromise = import('file-type');
  return fileTypeModulePromise;
}

// Returns the detected { ext, mime } from the buffer's actual content, or
// null if the content doesn't match any known file signature at all.
async function detectFileType(buffer) {
  const { fileTypeFromBuffer } = await loadFileType();
  const detected = await fileTypeFromBuffer(buffer);
  return detected || null;
}

module.exports = { detectFileType };
