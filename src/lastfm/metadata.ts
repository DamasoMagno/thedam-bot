import type { TrackView } from '../music/types.ts';
export function lastFmMetadata(track: TrackView | null) {
  if (!track) return null;
  let artist = track.requestedArtist,
    title = track.requestedTitle;
  if (!artist || !title) {
    // Only use explicit Artist — Track labels; uploader names are not artists.
    const split = /^(.{1,120}?)\s+[-–—]\s+(.{1,180})$/u.exec(track.title);
    if (!split) return null;
    [, artist, title] = split;
  }
  return {
    artist: artist.trim(),
    track: title.trim(),
    duration: Number(track.duration) || 0,
  };
}
