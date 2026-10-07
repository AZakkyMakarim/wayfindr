import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Boundary } from "../server/region-boundary-finder/types.ts";

export function RegionPreview({ boundary }: { boundary: Boundary }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const map = L.map(container.current!);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; kontributor <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const outline = L.geoJSON(boundary).addTo(map);
    map.fitBounds(outline.getBounds(), { padding: [16, 16] });
    return () => {
      map.remove();
    };
  }, [boundary]);

  return <div ref={container} className="region-preview" />;
}
