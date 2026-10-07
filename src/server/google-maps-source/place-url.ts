// The address of a place's own page on Google Maps. The second half of the
// Google identity ("0x...:0x...") is the place's CID in hexadecimal. An
// identity of another shape has no known address.
export function googleMapsUrl(googleId: string): string | null {
  const cid = googleId.match(/^0x[0-9a-f]+:(0x[0-9a-f]+)$/i)?.[1];
  return cid ? `https://www.google.com/maps?cid=${BigInt(cid)}` : null;
}
