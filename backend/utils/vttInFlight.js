/** Tracks video IDs currently undergoing VTT/description generation on this server. */

const inFlight = new Set();

export function markVideoInFlight(videoId) {
  if (videoId) inFlight.add(videoId);
}

export function releaseVideoInFlight(videoId) {
  if (videoId) inFlight.delete(videoId);
}

export function isVideoInFlight(videoId) {
  return inFlight.has(videoId);
}
