import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { LatLng } from "@/lib/tracker-types";

// Fix default Leaflet marker icons (otherwise broken in bundlers)
const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function ClickAdder({ onAdd }: { onAdd: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function FitBounds({ path, center }: { path: LatLng[]; center: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (path.length > 1) {
      const bounds = L.latLngBounds(path.map((p) => L.latLng(p[0], p[1])));
      map.fitBounds(bounds, { padding: [30, 30] });
    } else if (center) {
      map.setView(center, 13);
    }
  }, [path, center, map]);
  return null;
}

export interface WalkMapProps {
  path: LatLng[];
  onAddPoint: (p: LatLng) => void;
  liveLocation: LatLng | null;
  flyTo: LatLng | null;
}

export function WalkMap({ path, onAddPoint, liveLocation, flyTo }: WalkMapProps) {
  const [mounted, setMounted] = useState(false);
  const initial = useRef<LatLng>([51.505, -0.09]);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="w-full h-full rounded-lg bg-card" />;
  }

  return (
    <MapContainer
      center={initial.current}
      zoom={13}
      style={{ width: "100%", height: "100%", borderRadius: 8 }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickAdder onAdd={onAddPoint} />
      <FitBounds path={path} center={flyTo ?? liveLocation} />
      {path.length > 1 && (
        <Polyline positions={path} pathOptions={{ color: "#1d4e9f", weight: 5, dashArray: "10,5" }} />
      )}
      {path.map((p, i) => (
        <Marker key={i} position={p} />
      ))}
      {liveLocation && <Marker position={liveLocation} />}
    </MapContainer>
  );
}
