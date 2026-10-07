// The address of a place's own page on Google Maps. The second half of the
// Google identity ("0x...:0x...") is the place's CID in hexadecimal.
export function googleMapsUrl(googleId: string): string {
  const cid = BigInt(googleId.slice(googleId.indexOf(":") + 1));
  return `https://www.google.com/maps?cid=${cid}`;
}
